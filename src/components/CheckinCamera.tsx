"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, Loader2, QrCode } from "lucide-react";

interface CheckinCameraProps {
  onScan: (code: string) => void;
}

type CameraSession = {
  cancelled: boolean;
  scanner: Html5Qrcode | null;
  container: HTMLDivElement;
  ready: Promise<void>;
  closing?: Promise<void>;
};

function stopTracks(container: HTMLDivElement) {
  container.querySelectorAll("video").forEach((video) => {
    const stream = video.srcObject;
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  });
}

function closeSession(session: CameraSession) {
  session.cancelled = true;
  if (!session.closing) {
    session.closing = (async () => {
      // start() cannot be cancelled; retain this session until it settles.
      await session.ready;
      const videos = Array.from(session.container.querySelectorAll("video"));
      try {
        if (session.scanner?.isScanning) await session.scanner.stop();
      } finally {
        // Keep video references because stop() can remove them from the DOM.
        videos.forEach((video) => {
          const stream = video.srcObject;
          if (stream instanceof MediaStream) {
            stream.getTracks().forEach((track) => track.stop());
          }
        });
        stopTracks(session.container);
        session.scanner?.clear();
      }
    })();
  }
  return session.closing;
}

function cameraError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/NotAllowed|PermissionDenied|permission denied|SecurityError/i.test(message)) {
    return "ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตกล้องในการตั้งค่าเบราว์เซอร์แล้วลองใหม่";
  }
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(message)) {
    return "ไม่พบกล้องที่ใช้งานได้ กรุณาเชื่อมต่อกล้องแล้วลองใหม่";
  }
  if (/NotReadable|TrackStart|AbortError|Could not start/i.test(message)) {
    return "เปิดกล้องไม่ได้ กล้องอาจถูกใช้งานอยู่ กรุณาปิดแอปอื่นที่ใช้กล้องแล้วลองใหม่";
  }
  return "ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบสิทธิ์กล้องและลองใหม่อีกครั้ง";
}

export default function CheckinCamera({ onScan }: CheckinCameraProps) {
  const id = useId();
  const readerId = `checkin-camera-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onScan);
  const sessionRef = useRef<CameraSession | null>(null);
  const mountedRef = useRef(false);
  const recentCodes = useRef(new Map<string, number>());
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "stopping">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (session) {
        // Also release tracks already attached while start() is still pending.
        stopTracks(session.container);
        void closeSession(session).catch(() => {
          stopTracks(session.container);
        });
      }
    };
  }, []);

  async function startCamera() {
    const container = containerRef.current;
    if (!container || sessionRef.current || !mountedRef.current) return;
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("เบราว์เซอร์นี้ไม่รองรับกล้อง หรือการเชื่อมต่อไม่ปลอดภัย กรุณาใช้ HTTPS หรือ localhost");
      return;
    }

    const session: CameraSession = {
      cancelled: false,
      scanner: null,
      container,
      ready: Promise.resolve(),
    };
    sessionRef.current = session;
    setStatus("starting");
    session.ready = (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (session.cancelled) return;
        session.scanner = new Html5Qrcode(readerId, { verbose: false });
        await session.scanner.start(
          { facingMode: "environment" },
          { fps: 10 },
          (code) => {
            if (session.cancelled || !mountedRef.current) return;
            const now = performance.now();
            for (const [value, time] of recentCodes.current) {
              if (now - time >= 3000) recentCodes.current.delete(value);
            }
            if (recentCodes.current.has(code)) return;
            recentCodes.current.set(code, now);
            callbackRef.current(code);
          },
          () => {}, // Frames without a readable code are normal, not camera errors.
        );
        if (!session.cancelled && mountedRef.current) setStatus("scanning");
      } catch (cause) {
        if (!session.cancelled && mountedRef.current) setError(cameraError(cause));
        session.cancelled = true;
      }
    })();

    await session.ready;
    if (session.cancelled) await finishSession(session);
  }

  async function finishSession(session: CameraSession) {
    try {
      await closeSession(session);
    } catch {
      if (mountedRef.current) {
        setError("ปิดตัวสแกนไม่สมบูรณ์ ระบบหยุดแทร็กกล้องแล้ว กรุณาลองใหม่");
      }
    } finally {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        if (mountedRef.current) setStatus("idle");
      }
    }
  }

  function stopCamera() {
    const session = sessionRef.current;
    if (!session || session.cancelled) return;
    setStatus("stopping");
    void finishSession(session);
  }

  const busy = status === "starting" || status === "stopping";

  return (
    <section className="rounded-2xl border border-sky-400/20 bg-blu-dark p-5 text-white shadow-lg">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <QrCode aria-hidden="true" className="h-5 w-5 text-sky-400" />
        สแกนโค้ดที่เคาน์เตอร์
      </h2>
      <p className="mt-2 text-sm text-sky-100/70">
        กดเปิดกล้อง แล้วสแกนเฉพาะรหัสที่หน้านี้รองรับ
      </p>
      <div className="relative mt-4 min-h-56 overflow-hidden rounded-xl border border-sky-400/20 bg-black/30">
        <div id={readerId} ref={containerRef} className="w-full" />
        {status === "idle" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-sky-200/60">
            <CameraOff aria-hidden="true" className="h-10 w-10" />
            <span className="text-sm">กล้องยังไม่เปิด</span>
          </div>
        )}
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-sky-200">
        {status === "idle" && "กล้องจะเปิดเมื่อคุณกดปุ่มเท่านั้น"}
        {status === "starting" && "กำลังเปิดกล้อง กรุณาอนุญาตการเข้าถึงกล้อง"}
        {status === "scanning" && "พร้อมสแกน กรุณาถือโค้ดให้นิ่งและมีแสงเพียงพอ"}
        {status === "stopping" && "กำลังปิดกล้อง หากมีหน้าต่างขอสิทธิ์ค้างอยู่ กรุณาปิดหน้าต่างนั้น"}
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-yellow-300">{error}</p>}
      <button
        type="button"
        onClick={status === "idle" ? startCamera : stopCamera}
        disabled={status === "stopping"}
        aria-controls={readerId}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-400 px-4 py-3 font-bold text-blu-dark transition hover:bg-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-400 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : <Camera aria-hidden="true" className="h-5 w-5" />}
        {status === "idle" ? "เปิดกล้องเพื่อสแกน" : status === "starting" ? "ยกเลิกการเปิดกล้อง" : status === "stopping" ? "กำลังปิดกล้อง…" : "หยุดสแกนและปิดกล้อง"}
      </button>
    </section>
  );
}
