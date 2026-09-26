import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { v2 as cloudinary } from "cloudinary";
import { getCurrentMember } from "@/lib/auth/server";
import { sameOrigin } from "@/lib/auth/http";

// Configure Cloudinary
if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export async function GET() {
  const member = await getCurrentMember();
  if (member?.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const results: Record<string, any> = {};

  // 1. Neon Database Test
  const dbStart = Date.now();
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL is not defined in environment");
    const sql = neon(dbUrl);
    const dbRes = await sql`SELECT NOW() as current_time, version() as pg_version`;
    results.database = {
      status: "SUCCESS",
      latencyMs: Date.now() - dbStart,
      data: {
        serverTime: dbRes[0]?.current_time,
        version: dbRes[0]?.pg_version?.split(" ")[0] || "PostgreSQL",
      },
    };
  } catch (error: any) {
    results.database = {
      status: "ERROR",
      latencyMs: Date.now() - dbStart,
      error: error.message || "Database connection failed",
    };
  }

  // 2. Cloudinary Test
  const cldStart = Date.now();
  try {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error("Cloudinary credentials are not fully configured");
    }
    const pingRes = await cloudinary.api.ping();
    results.cloudinary = {
      status: "SUCCESS",
      latencyMs: Date.now() - cldStart,
      data: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        pingResult: pingRes.status || "ok",
      },
    };
  } catch (error: any) {
    results.cloudinary = {
      status: "ERROR",
      latencyMs: Date.now() - cldStart,
      error: error.message || "Cloudinary ping failed",
    };
  }

  // 3. EasySlip API Test
  const easyStart = Date.now();
  try {
    const easyKey = process.env.EASYSLIP_API_KEY;
    if (!easyKey) throw new Error("EASYSLIP_API_KEY is not configured");

    const easyRes = await fetch("https://developer.easyslip.com/api/v1/verify", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${easyKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      cache: "no-store",
    });

    const easyData = await easyRes.json().catch(() => ({}));
    
    if (easyRes.status === 200 || easyRes.status === 400) {
      results.easyslip = {
        status: "SUCCESS",
        latencyMs: Date.now() - easyStart,
        data: {
          message: "API Key Authorized & Ready to Verify Slips",
          tokenValid: true,
          statusText: easyRes.status === 200 ? "OK" : "Ready (Awaiting Slips)",
        },
      };
    } else {
      results.easyslip = {
        status: "ERROR",
        latencyMs: Date.now() - easyStart,
        data: {
          statusCode: easyRes.status,
          message: easyData.message || "Invalid API Key or Unauthorized",
        },
      };
    }
  } catch (error: any) {
    results.easyslip = {
      status: "ERROR",
      latencyMs: Date.now() - easyStart,
      error: error.message || "Failed to reach EasySlip API",
    };
  }

  // 4. ThaiBulkSMS Test
  const smsStart = Date.now();
  try {
    const apiKey = process.env.SMS_API_KEY;
    const apiSecret = process.env.SMS_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error("SMS_API_KEY or SMS_API_SECRET is missing");

    const authHeader = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
    
    const smsRes = await fetch("https://api-v2.thaibulksms.com/credit", {
      method: "GET",
      headers: { Authorization: `Basic ${authHeader}` },
      cache: "no-store",
    });
    const smsData = await smsRes.json().catch(() => ({}));

    results.thaibulksms = {
      status: smsRes.ok ? "SUCCESS" : "ERROR",
      latencyMs: Date.now() - smsStart,
      data: smsRes.ok
        ? {
            credit: smsData?.credit ?? smsData?.total_credit ?? "OK",
            raw: smsData,
          }
        : { statusCode: smsRes.status, message: smsData?.error?.message || "ThaiBulkSMS authentication failed" },
    };
  } catch (error: any) {
    results.thaibulksms = {
      status: "ERROR",
      latencyMs: Date.now() - smsStart,
      error: error.message || "Failed to reach ThaiBulkSMS API",
    };
  }

  // 5. LINE Messaging API Test
  const lineStart = Date.now();
  try {
    const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!lineToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");

    const lineRes = await fetch("https://api.line.me/v2/bot/info", {
      method: "GET",
      headers: { Authorization: `Bearer ${lineToken}` },
      cache: "no-store",
    });

    const lineData = await lineRes.json();
    results.line = {
      status: lineRes.ok ? "SUCCESS" : "ERROR",
      latencyMs: Date.now() - lineStart,
      data: lineRes.ok
        ? {
            botName: lineData.displayName,
            basicId: lineData.basicId,
            premiumId: lineData.premiumId,
            pictureUrl: lineData.pictureUrl,
            chatMode: lineData.chatMode,
            markAsReadMode: lineData.markAsReadMode,
          }
        : { statusCode: lineRes.status, message: lineData.message || "Invalid LINE Channel Access Token" },
    };
  } catch (error: any) {
    results.line = {
      status: "ERROR",
      latencyMs: Date.now() - lineStart,
      error: error.message || "Failed to reach LINE Messaging API",
    };
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    results,
  });
}

// Interactive POST (Send SMS using official ThaiBulkSMS API v2.0)
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const member = await getCurrentMember();
  if (member?.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json();
    const { action, phone, message } = body;

    if (action === "send-test-sms") {
      const apiKey = process.env.SMS_API_KEY;
      const apiSecret = process.env.SMS_API_SECRET;
      const sender = process.env.SMS_SENDER_NAME || "Demo";

      if (!apiKey || !apiSecret) {
        return NextResponse.json(
          { success: false, message: "SMS Credentials are missing in .env.local" },
          { status: 400 }
        );
      }

      const cleanPhone = phone.replace(/[^0-9]/g, "");
      const authHeader = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

      // Payload according to official ThaiBulkSMS API v2.0 PDF (Page 4 & 12)
      const smsPayload = new URLSearchParams({
        msisdn: cleanPhone,
        message: message || `[Blu Fitness] รหัส OTP ทดสอบระบบคือ ${Math.floor(100000 + Math.random() * 900000)}`,
        sender: sender,
      });

      const res = await fetch("https://api-v2.thaibulksms.com/sms", {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: smsPayload.toString(),
      });

      const data = await res.json().catch(() => ({}));

      return NextResponse.json({
        success: res.ok && !data.error,
        status: res.status,
        senderUsed: sender,
        data,
      });
    }

    return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
