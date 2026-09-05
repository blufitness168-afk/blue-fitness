"use client";

import Image from "next/image";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Gift, CheckCircle2, Sparkles } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useLanguage } from "@/context/LanguageContext";
import { mockRewards, RewardItem, MemberProfile, defaultMockMember } from "@/lib/mock-data";

export default function RewardsPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [redeeming, setRedeeming] = useState<Record<number, boolean>>({});
  const [redeemed, setRedeemed] = useState<Record<number, boolean>>({});
  const [successModal, setSuccessModal] = useState<RewardItem | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("blu_member");
      if (saved) {
        setMember(JSON.parse(saved));
      } else {
        setMember(defaultMockMember);
      }
    } catch (e) {}
  }, []);

  const availableRewards = useMemo(
    () => mockRewards.filter((r) => r.isActive),
    []
  );

  const handleRedeem = (reward: RewardItem) => {
    if (!member) return;

    if (member.points < reward.pointCost) {
      setInfoMsg(t("rewards.insufficient"));
      setTimeout(() => setInfoMsg(null), 2500);
      return;
    }

    setRedeeming((prev) => ({ ...prev, [reward.id]: true }));

    // Simulate API call delay
    setTimeout(() => {
      const code = "BLU-RW-" + reward.id + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      setRedeemCode(code);

      // Deduct points locally
      setMember((prev) => (prev ? { ...prev, points: Math.max(0, prev.points - reward.pointCost) } : prev));
      setRedeemed((prev) => ({ ...prev, [reward.id]: true }));
      setRedeeming((prev) => ({ ...prev, [reward.id]: false }));
      setSuccessModal(reward);
    }, 900);
  };

  const handleLogout = () => {
    localStorage.removeItem("blu_member");
    router.push("/");
  };

  if (!member) {
    return (
      <div className="min-h-screen bg-blu-dark flex items-center justify-center text-white">
        <div className="w-8 h-8 border-3 border-blu-slate border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-blu-ice text-blu-dark">
      {/* NAVBAR */}
      <Navbar member={member} onLogout={handleLogout} />

      {/* MAIN */}
      <main className="max-w-md mx-auto px-4 pt-24 pb-16 space-y-5">
        {/* Back Link */}
        <div>
          <a
            href="/member"
            className="inline-flex items-center gap-1 text-xs text-blu-steel hover:text-blu-dark font-medium transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {t("rewards.back")}
          </a>
        </div>

        {/* Header */}
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-blu-dark tracking-tight">
              {t("rewards.title")}
            </h1>
            <Sparkles className="w-5 h-5 text-blu-yellow" />
          </div>
          <p className="text-xs text-blu-steel">{t("rewards.subtitle")}</p>
        </header>

        {/* Points Card */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blu-dark via-blu-navy to-blu-dark text-white p-5 border-2 border-blu-yellow/40 shadow-xl">
          {/* Decorative glow circles */}
          <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-blu-yellow/10 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-blu-ice/10 blur-2xl pointer-events-none" />

          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-blu-yellow/20 border border-blu-yellow/30 flex items-center justify-center">
                <Gift className="w-6 h-6 text-blu-yellow" />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-blu-sky/80 font-semibold">
                  {t("rewards.my_points")}
                </div>
                <div className="text-2xl font-black text-blu-yellow leading-none">
                  {member.points.toLocaleString()}
                  <span className="text-blu-sky/70 text-sm font-bold ml-1">
                    {t("rewards.out_of")}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-blu-yellow/90 bg-blu-yellow/10 px-2.5 py-1 rounded-full border border-blu-yellow/20">
                {member.points <= 20 ? "Almost there!" : "Great job!"}
              </div>
            </div>
          </div>
        </section>

        {/* Rewards Grid — 2 cards per row */}
        <section className="grid grid-cols-2 gap-3">
          {availableRewards.length === 0 ? (
            <div className="col-span-2 rounded-2xl bg-white border border-blu-sky/40 p-8 text-center text-sm text-blu-steel">
              {t("rewards.empty")}
            </div>
          ) : (
            availableRewards.map((reward) => {
              const isRedeemed = redeemed[reward.id];
              const isRedeeming = redeeming[reward.id];
              const canRedeem = member.points >= reward.pointCost && reward.stock > 0 && !isRedeemed;
              const title = lang === "th" ? reward.title : reward.titleEn;
              const desc = lang === "th" ? reward.description : reward.descriptionEn;

              return (
                <article
                  key={reward.id}
                  className="group bg-white rounded-2xl border border-blu-sky/40 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col"
                >
                  <div className="relative aspect-[4/3] w-full bg-blu-ice overflow-hidden">
                    <Image
                      src={reward.imageUrl}
                      alt={title}
                      fill
                      sizes="(max-width: 640px) 50vw, 240px"
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      priority={reward.id <= 2}
                    />
                    {/* Points badge */}
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-blu-dark/85 backdrop-blur-sm text-blu-yellow text-[10px] font-bold px-2 py-1 rounded-lg shadow-sm">
                      <Gift className="w-3 h-3" /> {reward.pointCost}
                    </span>
                    {/* Sold out overlay */}
                    {reward.stock <= 0 && (
                      <div className="absolute inset-0 bg-blu-dark/60 backdrop-blur-[1px] flex items-center justify-center">
                        <span className="text-blu-yellow text-xs font-black px-3 py-1.5 bg-blu-dark/80 rounded-full">
                          {t("rewards.out_of_stock")}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-3 flex flex-col flex-1 gap-2">
                    <div className="flex-1">
                      <h3 className="text-[13px] font-bold text-blu-dark leading-snug line-clamp-2">
                        {title}
                      </h3>
                      <p className="text-[10px] text-blu-steel mt-1 leading-relaxed line-clamp-2">
                        {desc}
                      </p>
                    </div>

                    <button
                      onClick={() => handleRedeem(reward)}
                      disabled={!canRedeem || isRedeeming}
                      className={
                        isRedeemed
                          ? "w-full py-2 rounded-lg text-[11px] font-bold bg-blu-ice text-blu-steel border border-blu-sky/40 cursor-default"
                          : canRedeem
                          ? "btn-gold w-full py-2 rounded-lg text-[11px] font-bold shadow-sm"
                          : "w-full py-2 rounded-lg text-[11px] font-bold bg-blu-sky/50 text-white cursor-not-allowed"
                      }
                    >
                      {isRedeemed
                        ? t("rewards.used")
                        : isRedeeming
                        ? t("rewards.redeeming")
                        : canRedeem
                        ? t("rewards.redeem_btn")
                        : reward.stock <= 0
                        ? t("rewards.out_of_stock")
                        : t("rewards.insufficient")}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </main>

      {/* Info Toast (insufficient points) */}
      {infoMsg && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-8 z-[70] animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="flex items-center gap-2 bg-blu-dark text-white px-4 py-2.5 rounded-xl shadow-xl border border-blu-sky/30 text-xs font-semibold">
            <Gift className="w-4 h-4 text-blu-yellow" />
            {infoMsg}
          </div>
        </div>
      )}

      {/* Success Modal */}
      {successModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-blu-dark/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="relative mx-auto w-16 h-16 rounded-full bg-blu-yellow/20 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-9 h-9 text-blu-yellow" />
              <span className="absolute -top-1 -right-1 bg-blu-yellow text-blu-dark rounded-full p-0.5">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
            </div>
            <h3 className="text-lg font-black text-blu-dark">
              {t("rewards.success_title")}
            </h3>
            <p className="text-xs text-blu-steel mt-1.5 leading-relaxed">
              {t("rewards.success_desc")}
            </p>

            <div className="mt-4 rounded-xl bg-blu-ice border border-blu-sky/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-blu-steel font-semibold mb-1">
                {t("details.code")}
              </div>
              <div className="font-mono font-bold text-blu-dark tracking-wider text-sm break-all">
                {redeemCode}
              </div>
            </div>

            <button
              onClick={() => setSuccessModal(null)}
              className="mt-4 btn-gold w-full py-2.5 rounded-xl text-xs font-bold"
            >
              {t("rewards.close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
