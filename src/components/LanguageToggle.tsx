"use client";

import React from "react";
import { useLanguage } from "@/context/LanguageContext";

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
          : "bg-blu-ice border-blu-sky/60 text-blu-dark shadow-xs"
      }`}
    >
      <button
        type="button"
        onClick={() => setLang("th")}
        className={`px-2.5 py-1 rounded-full transition-all cursor-pointer ${
          lang === "th"
            ? variant === "dark"
              ? "bg-blu-yellow text-blu-dark font-black shadow-xs"
              : "bg-blu-slate text-white font-black shadow-xs"
            : variant === "dark"
            ? "text-white/70 hover:text-white"
            : "text-blu-steel hover:text-blu-dark"
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
              ? "bg-blu-yellow text-blu-dark font-black shadow-xs"
              : "bg-blu-slate text-white font-black shadow-xs"
            : variant === "dark"
            ? "text-white/70 hover:text-white"
            : "text-blu-steel hover:text-blu-dark"
        }`}
      >
        EN
      </button>
    </div>
  );
}
