<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Strict Working Rules
- **แก้ไขเฉพาะส่วนที่ผู้ใช้สั่งเท่านั้น**: ห้ามแก้ไขหรือแตะต้องโค้ด/UI/ไฟล์ในส่วนที่ผู้ใช้ไม่ได้สั่งโดยเด็ดขาด
- **ถ้าอยากแก้หรือมีไอเดีย ให้เสนอถามก่อนเสมอ**: เสนอเป็นข้อความให้ผู้ใช้พิจารณาก่อน ห้ามลงมือแก้ไขเองโดยไม่ได้รับคำสั่ง
- **การจัดการ Database ในช่วงทดลอง (Testing/Trial Period)**: ไม่ต้อง Backup และไม่ต้อง Play-safe เพื่อรักษาข้อมูลเดิม เพราะก่อนวันเปิดใช้งานจริง (Go-live) จะมีการลบข้อมูลทั้งหมดใน DB แล้วลงใหม่อยู่แล้ว สามารถรัน DDL / Migration / Reset ข้อมูลทดสอบได้ทันทีอย่างรวดเร็ว


