"use client";

import React from "react";
import { useLanguage } from "@/context/LanguageContext";
import { Globe } from "lucide-react";

interface LanguageToggleProps {
  variant?: "dark" | "light";
}

export default function LanguageToggle({ variant = "dark" }: LanguageToggleProps) {
  const { lang, setLang } = useLanguage();

  return (
    <div
      className={`inline-flex items-center rounded-full p-0.5 text-xs font-bold transition-all border ${
        variant === "dark"
          ? "bg-white/10 border-white/15 text-white"
          : "bg-slate-100 border-slate-200 text-slate-700 shadow-xs"
      }`}
    >
      <button
        type="button"
        onClick={() => setLang("th")}
        className={`px-2.5 py-1 rounded-full transition-all cursor-pointer ${
          lang === "th"
            ? variant === "dark"
              ? "bg-[#ffd700] text-[#0a1628] font-black shadow-xs"
              : "bg-[#003087] text-white font-black shadow-xs"
            : variant === "dark"
            ? "text-white/70 hover:text-white"
            : "text-slate-500 hover:text-slate-800"
        }`}
      >
        TH
      </button>

      <button
        type="button"
        onClick={() => setLang("en")}
        className={`px-2.5 py-1 rounded-full transition-all cursor-pointer ${
          lang === "en"
            ? variant === "dark"
              ? "bg-[#ffd700] text-[#0a1628] font-black shadow-xs"
              : "bg-[#003087] text-white font-black shadow-xs"
            : variant === "dark"
            ? "text-white/70 hover:text-white"
            : "text-slate-500 hover:text-slate-800"
        }`}
      >
        EN
      </button>
    </div>
  );
}
