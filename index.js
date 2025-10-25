import express from "express";
import cors from "cors";
import { Pool } from "pg";

const app = express();
app.use(express.json());

// ✅ 僅允許你的 Flutter 網域存取
app.use(cors({
  origin: ["https://elainediet.zeabur.app"],
}));

// ✅ 使用你的 PostgreSQL 連線字串
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://root:8JOLRf5ByMdU0v36Yq1T2F7rEGp9egX4@hnd1.clusters.zeabur.com:25440/zeabur",
  ssl: { rejectUnauthorized: false }, // Zeabur 資料庫通常要開啟 SSL
});

// 自動建立資料表
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

// 健康檢查
app.get("/", (req, res) => res.send("✅ ElaineDiet API running"));

// ➕ 新增一筆紀錄
app.post("/records", async (req, res) => {
  try {
    const {
      date, meal,
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

    if (!date || !meal) return res.status(400).json({ error: "date and meal are required" });

    const result = await pool.query(
      `INSERT INTO meal_records
      (date, meal, whole_grains, vegetables, protein_low, protein_med, protein_high, protein_xhigh, junk_food, note, image_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [date, meal, whole_grains, vegetables, protein_low, protein_med, protein_high, protein_xhigh, junk_food, note, image_url]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "insert failed" });
  }
});

// 📅 每日彙總
app.get("/summary", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required" });

    const result = await pool.query(`
      SELECT
        COALESCE(SUM(whole_grains),0) AS whole_grains,
        COALESCE(SUM(vegetables),0) AS vegetables,
        COALESCE(SUM(protein_low + protein_med + protein_high + protein_xhigh),0) AS protein_total,
        COALESCE(SUM(junk_food),0) AS junk_food
      FROM meal_records
      WHERE date = $1
    `, [date]);

    res.json({ date, ...result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "summary failed" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 ElaineDiet API running on ${port}`));
