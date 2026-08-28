export default function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0a1628] text-white flex flex-col">
      {children}
    </div>
  );
}
