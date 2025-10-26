import express from "express";
import cors from "cors";
import { Pool } from "pg";

const app = express();
app.use(express.json());

/* ---------------- CORS ----------------
   允許：
   1) 正式站：https://elainediet.zeabur.app
   2) 任何 localhost（任意 port）
   3) 任何 Zeabur 子網域（例如 https://dietapi.zeabur.app）
--------------------------------------- */
const allowList = ["https://elainediet.zeabur.app"];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // 同網域或 Postman/CLI
      const isAllowed =
        allowList.includes(origin) ||
        /^http:\/\/localhost(:\d+)?$/.test(origin) || // localhost 任意埠
        /^https:\/\/.*\.zeabur\.app$/.test(origin);   // 任何 Zeabur 子網域
      cb(null, isAllowed);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
  })
);

// 預檢請求
app.options("*", cors());

/* ---------------- PostgreSQL 連線 ----------------
   Zeabur PG 通常需要 SSL
--------------------------------------------------- */
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://root:8JOLRf5ByMdU0v36Yq1T2F7rEGp9egX4@hnd1.clusters.zeabur.com:25440/zeabur?sslmode=require",
  ssl: { rejectUnauthorized: false },
});

/* ---------------- 建表（若尚未存在） ---------------- */
await pool.query(`
CREATE TABLE IF NOT EXISTS meal_records (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date DATE NOT NULL,
  meal TEXT NOT NULL,
  whole_grains INT DEFAULT 0,
  vegetables INT DEFAULT 0,
  protein_low INT DEFAULT 0,
  protein_med INT DEFAULT 0,
  protein_high INT DEFAULT 0,
  protein_xhigh INT DEFAULT 0,
  junk_food INT DEFAULT 0,
  note TEXT,
  image_url TEXT
);
`);
console.log("✅ Table meal_records ready!");

/* ---------------- 健康檢查 ---------------- */
app.get("/", (req, res) => res.send("✅ ElaineDiet API running"));

/* 小工具：把 'yyyy/MM/dd' 或 Date 物件，轉成 'yyyy-MM-dd'（PG 最穩定） */
function toIsoDateOnly(input) {
  if (typeof input === "string") {
    const normalized = input.replace(/\//g, "-"); // 2025-10-25
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
    return d.toISOString().slice(0, 10);
  }
  if (input instanceof Date) {
    return input.toISOString().slice(0, 10);
  }
  throw new Error(`Invalid date input: ${input}`);
}

/* 小工具：把可能是字串的數字安全轉成整數，空值或 NaN -> 0 */
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- 新增一筆紀錄 ---------------- */
app.post("/records", async (req, res) => {
  try {
    const {
      date, // '2025/10/25' 或 '2025-10-25'
      meal, // 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack'
      whole_grains = 0,
      vegetables = 0,
      protein_low = 0,
      protein_med = 0,
      protein_high = 0,
      protein_xhigh = 0,
      junk_food = 0,
      note = null,
      image_url = null,
    } = req.body;

    if (!date || !meal) {
      return res.status(400).json({ error: "date and meal are required" });
    }

    // 1) 日期格式轉成 PG 穩定格式
    const isoDate = toIsoDateOnly(date);

    // 2) 數字欄位轉整數
    const payload = {
      whole_grains: toInt(whole_grains),
      vegetables: toInt(vegetables),
      protein_low: toInt(protein_low),
      protein_med: toInt(protein_med),
      protein_high: toInt(protein_high),
      protein_xhigh: toInt(protein_xhigh),
      junk_food: toInt(junk_food),
    };

    const result = await pool.query(
      `INSERT INTO meal_records
       (date, meal, whole_grains, vegetables, protein_low, protein_med, protein_high, protein_xhigh, junk_food, note, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        isoDate,
        meal,
        payload.whole_grains,
        payload.vegetables,
        payload.protein_low,
        payload.protein_med,
        payload.protein_high,
        payload.protein_xhigh,
        payload.junk_food,
        note,
        image_url,
      ]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error("❌ INSERT ERROR:", e.message, e.stack);
    res.status(500).json({ error: "insert failed", detail: e.message });
  }
});

/* ---------------- 依日期查詢當日紀錄（列表） ----------------
   用法：
   - GET /records?date=2025-10-25
   - GET /records?from=2025-10-01&to=2025-10-31   // 區間
   - 可選：?limit=50&offset=0&order=desc           // 分頁 / 排序
---------------------------------------------------------------- */
app.get("/records", async (req, res) => {
  try {
    let { date, from, to, limit = "100", offset = "0", order = "desc" } = req.query;

    // 合法化 limit/offset
    limit = Math.max(0, Math.min(parseInt(limit, 10) || 100, 500));
    offset = Math.max(0, parseInt(offset, 10) || 0);
    order = (String(order).toLowerCase() === "asc") ? "ASC" : "DESC";

    const where = [];
    const params = [];

    // 單日 or 區間擇一
    if (date) {
      params.push(toIsoDateOnly(date));
      where.push(`date = $${params.length}`);
    } else {
      if (from) {
        params.push(toIsoDateOnly(from));
        where.push(`date >= $${params.length}`);
      }
      if (to) {
        params.push(toIsoDateOnly(to));
        where.push(`date <= $${params.length}`);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT
        id, created_at, date, meal,
        whole_grains, vegetables,
        protein_low, protein_med, protein_high, protein_xhigh,
        junk_food, note, image_url
      FROM meal_records
      ${whereSql}
      ORDER BY created_at ${order}
      LIMIT ${limit} OFFSET ${offset};
    `;

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (e) {
    console.error("❌ LIST ERROR:", e.message, e.stack);
    res.status(500).json({ error: "list failed", detail: e.message });
  }
});


/* ---------------- 每日彙總（?date=yyyy-MM-dd / yyyy/MM/dd） ---------------- */
app.get("/summary", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required" });

    const isoDate = toIsoDateOnly(date);

    const result = await pool.query(
      `SELECT
         COALESCE(SUM(whole_grains),0) AS whole_grains,
         COALESCE(SUM(vegetables),0) AS vegetables,
         COALESCE(SUM(protein_low + protein_med + protein_high + protein_xhigh),0) AS protein_total,
         COALESCE(SUM(junk_food),0) AS junk_food
       FROM meal_records
       WHERE date = $1`,
      [isoDate]
    );

    res.json({ date: isoDate, ...result.rows[0] });
  } catch (e) {
    console.error("❌ SUMMARY ERROR:", e.message, e.stack);
    res.status(500).json({ error: "summary failed", detail: e.message });
  }
});

/* ---------------- 服務啟動 ---------------- */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 ElaineDiet API running on ${port}`));
