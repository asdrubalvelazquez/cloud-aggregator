import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
      <div className="max-w-3xl p-8 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight">Cloud Aggregator ☁️</h1>
        <p className="mt-5 text-slate-300 text-lg">
          Conecta múltiples Google Drives, suma tu almacenamiento y copia archivos entre cuentas.
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="inline-flex rounded bg-emerald-500 px-6 py-3 font-semibold hover:bg-emerald-600"
          >
            Empezar
          </Link>
        </div>
      </div>
    </main>
  );
}
