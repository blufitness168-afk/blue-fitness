export default function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full bg-blu-dark flex flex-col">
      {children}
    </div>
  );
}
