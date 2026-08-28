export default function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f1f5f9] text-slate-900 flex flex-col">
      {children}
    </div>
  );
}
