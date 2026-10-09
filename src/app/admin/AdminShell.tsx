"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { canAccessAdminPath } from "@/lib/admin-permissions";
import {
  LayoutDashboard,
  Users,
  ScanLine,
  Gift,
  Ticket,
  WalletCards,
  LogOut,
  Menu,
} from "lucide-react";

const navItems = [
  { href: "/admin", labelTh: "ภาพรวม", icon: LayoutDashboard },
  { href: "/admin/members", labelTh: "สมาชิก", icon: Users },
  { href: "/admin/finance", labelTh: "รายรับ-รายจ่าย", icon: WalletCards },
  { href: "/admin/checkin", labelTh: "ประวัติการใช้บริการ", icon: ScanLine },
  { href: "/admin/rewards", labelTh: "ของรางวัล", icon: Gift },
  { href: "/admin/promo-codes", labelTh: "โค้ดส่วนลด", icon: Ticket },
  { href: "/admin/coupons", labelTh: "คูปอง", icon: Ticket },
];

export default function AdminShell({ children, role }: { children: React.ReactNode; role: "ADMIN" | "OWNER" }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const sidebar = (
    <nav className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-blu-navy/40 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0">
          <Image src="/logo.jpg" alt="Blu Fitness" width={36} height={36} className="w-full h-full object-cover" />
        </div>
        <div>
          <div className="text-white font-extrabold tracking-wider text-sm leading-none">
            BLU FITNESS
          </div>
          <div className="text-[10px] text-blu-sky/70 font-medium mt-1">
            Admin Console
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 px-3 py-4 space-y-1">
        {navItems.filter((item) => canAccessAdminPath(role, item.href)).map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={
                active
                  ? "flex items-center gap-3 px-3 py-2.5 rounded-xl bg-blu-yellow/15 text-blu-yellow border border-blu-yellow/30 font-semibold"
                  : "flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              }
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span className="text-xs sm:text-sm">{item.labelTh}</span>
            </Link>
          );
        })}
      </div>

      {/* Bottom */}
      <div className="px-3 py-4 border-t border-blu-navy/40">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/60 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-xs sm:text-sm">กลับหน้าแรก</span>
        </Link>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-blu-ice text-blu-dark">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 bottom-0 w-64 bg-blu-dark flex-col z-40">
        {sidebar}
      </aside>

      {/* Mobile Sidebar */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <aside className="w-72 bg-blu-dark flex-col">
            {sidebar}
          </aside>
          <button
            className="flex-1 bg-blu-dark/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
        </div>
      )}

      {/* Main Content */}
      <div className="lg:ml-64 flex flex-col min-h-screen">
        {/* Mobile Topbar */}
        <header className="lg:hidden sticky top-0 z-40 bg-blu-dark/95 backdrop-blur-md border-b border-blu-navy/40">
          <div className="px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg overflow-hidden">
                <Image src="/logo.jpg" alt="Blu Fitness" width={32} height={32} className="w-full h-full object-cover" />
              </div>
              <span className="text-white font-extrabold tracking-wider text-sm">
                BLU FITNESS
              </span>
            </div>
            <button
              onClick={() => setMobileOpen(true)}
              className="text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
