import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as dotenv from "dotenv";
import * as schema from "./schema";

dotenv.config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in .env.local");
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { schema });

async function main() {
  console.log("🌱 เริ่มต้นการ Seed ข้อมูลระบบ Blu Fitness...");

  // 1. Seed Packages (แพ็กเกจสมาชิก 4 ระดับตามข้อตกลง)
  console.log("📦 กำลังสร้างแพ็กเกจสมาชิกเริ่มต้น...");
  const initialPackages = [
    {
      name: "Package 30 วัน",
      durationDays: 30,
      price: "1200.00",
      friendCoupons: 5,
      bonusDays: 0,
      description: "เข้าใช้บริการได้ 30 วัน + ฟรีคูปองพาเพื่อนมาเล่นได้ 5 ครั้ง (1 คน/ครั้ง)",
      isActive: true,
    },
    {
      name: "Package 90 วัน",
      durationDays: 90,
      price: "3200.00",
      friendCoupons: 5,
      bonusDays: 15,
      description: "เข้าใช้บริการได้ 90 วัน + ฟรีคูปองพาเพื่อน 5 ครั้ง + คูปองเพิ่มวันใช้งาน 15 วัน",
      isActive: true,
    },
    {
      name: "Package 120 วัน",
      durationDays: 120,
      price: "4000.00",
      friendCoupons: 5,
      bonusDays: 30,
      description: "เข้าใช้บริการได้ 120 วัน + ฟรีคูปองพาเพื่อน 5 ครั้ง + คูปองเพิ่มวันใช้งาน 30 วัน",
      isActive: true,
    },
    {
      name: "Package 365 วัน (1 ปี)",
      durationDays: 365,
      price: "9900.00",
      friendCoupons: 10,
      bonusDays: 60,
      description: "เข้าใช้บริการได้ 1 ปีเต็ม + ฟรีคูปองพาเพื่อน 10 ครั้ง + คูปองเพิ่มวันใช้งาน 60 วันสุดคุ้ม",
      isActive: true,
    },
  ];

  for (const pkg of initialPackages) {
    await db
      .insert(schema.packages)
      .values(pkg)
      .onConflictDoNothing();
  }

  // 2. Seed Initial Rewards (ของรางวัลสำหรับแลกแต้มสะสม)
  console.log("🎁 กำลังสร้างของรางวัลเริ่มต้น...");
  const initialRewards = [
    {
      title: "เครื่องดื่มเกลือแร่ / น้ำดื่ม 1 ขวด",
      description: "แลกรับเครื่องดื่มเย็นสดชื่นที่เคาน์เตอร์ฟิตเนส",
      pointCost: 10,
      stock: 100,
      isActive: true,
    },
    {
      title: "ผ้าขนหนูออกกำลังกาย Blu Fitness",
      description: "ผ้าขนหนูซับเหงื่อไมโครไฟเบอร์ พรีเมียม พกพาสะดวก",
      pointCost: 30,
      stock: 50,
      isActive: true,
    },
    {
      title: "เสื้อยืด Blu Fitness Limited Edition",
      description: "เสื้อกีฬาเนื้อผ้าระบายอากาศดีเยี่ยม สกรีนโลโก้ทอง Blu Fitness",
      pointCost: 60,
      stock: 30,
      isActive: true,
    },
    {
      title: "ฟรีสมาชิกเพิ่ม 7 วัน",
      description: "รับวันใช้งานฟิตเนสเพิ่มฟรีทันที 7 วัน",
      pointCost: 80,
      stock: 999,
      isActive: true,
    },
  ];

  for (const reward of initialRewards) {
    await db
      .insert(schema.rewards)
      .values(reward)
      .onConflictDoNothing();
  }

  console.log("✅ Seed ข้อมูลสำเร็จเรียบร้อยแล้ว!");
}

main().catch((err) => {
  console.error("❌ เกิดข้อผิดพลาดในการ Seed ข้อมูล:", err);
  process.exit(1);
});
