import Link from "next/link";
import SilentAuthRedirect from "@/components/SilentAuthRedirect";
import SignInWithGoogleButton from "@/components/SignInWithGoogleButton";
import PerLetterGlowTitle from "@/components/PerLetterGlowTitle";

/**
 * Landing page - Server Component for better SEO and Google OAuth Brand Verification.
 * The content (including "Cloud Aggregator" name) is rendered in the initial HTML
 * so that Google's crawler can see it without executing JavaScript.
 * 
 * SilentAuthRedirect is a client component that handles the redirect logic
 * without blocking the initial render.
 */
export default function Home() {
  return (
    <>
      {/* Silent auth check - client component that doesn't block SSR */}
      <SilentAuthRedirect />
      
      <main className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#171717] dark:text-[#ededed]">
        {/* Subtle gradient overlay for depth */}
        <div className="fixed inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-50/50 dark:to-neutral-950/50 pointer-events-none" />
        
        <div className="relative">
          {/* Navigation */}
          <nav className="border-b border-gray-200 dark:border-neutral-800 bg-white/80 dark:bg-black/80 backdrop-blur-md sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                </div>
                <span className="font-semibold text-lg">Cloud Aggregator</span>
              </div>
              <div className="flex items-center gap-6">
                <Link href="/pricing" className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
                  Pricing
                </Link>
                <SignInWithGoogleButton variant="nav" />
              </div>
            </div>
          </nav>

          {/* Hero Section */}
          <section className="max-w-6xl mx-auto px-6 pt-24 pb-32 text-center">
            {/* App Name & Description - Critical for Google OAuth Brand Verification */}
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
              {/* Real text for SEO - visually hidden but present in DOM */}
              <span className="sr-only">Cloud Aggregator</span>
              {/* Visual layer with per-letter glow effect */}
              <span className="relative inline-block overflow-visible leading-[1.1] py-[0.15em]">
                <PerLetterGlowTitle 
                  text="Cloud Aggregator" 
                  className="bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-500 dark:from-emerald-300 dark:via-teal-300 dark:to-blue-300 bg-[length:200%_auto] animate-gradient bg-clip-text text-transparent"
                />
              </span>
            </h1>
            
            <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400 mb-4 max-w-3xl mx-auto leading-relaxed">
              Manage multiple Google Drive and OneDrive accounts from a single, unified interface.
            </p>

            <p className="text-sm text-gray-500 dark:text-gray-500 mb-12 max-w-2xl mx-auto">
              Cloud Aggregator is a multi-account cloud storage management app. Connect accounts, select files, and copy between drives with full user control.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
              <SignInWithGoogleButton variant="primary" />
              <Link
                href="#how-it-works"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-gray-300 dark:border-neutral-700 hover:border-gray-400 dark:hover:border-neutral-600 transition-colors font-medium text-gray-700 dark:text-gray-300"
              >
                See how it works
              </Link>
            </div>

            {/* Trust Indicators */}
            <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-gray-500 dark:text-gray-500">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Free plan available</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>User-controlled operations</span>
              </div>
            </div>
          </section>

          {/* How It Works Section */}
          <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">How it works</h2>
              <p className="text-gray-600 dark:text-gray-400 text-lg max-w-2xl mx-auto">
                Connect your accounts and manage files in three simple steps.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Step 1 */}
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl opacity-0 group-hover:opacity-100 blur transition-opacity duration-300" />
                <div className="relative p-8 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold text-xl mb-6">
                    1
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Connect accounts</h3>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                    Securely connect multiple Google Drive and OneDrive accounts using OAuth. Each account remains completely separate.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-purple-600 rounded-2xl opacity-0 group-hover:opacity-100 blur transition-opacity duration-300" />
                <div className="relative p-8 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 font-bold text-xl mb-6">
                    2
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Select files</h3>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                    Use Google Picker to browse and select specific files. Only files you explicitly choose are accessible.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-green-500 to-green-600 rounded-2xl opacity-0 group-hover:opacity-100 blur transition-opacity duration-300" />
                <div className="relative p-8 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400 font-bold text-xl mb-6">
                    3
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Copy with control</h3>
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                    Manually initiate copy operations between accounts. Every action requires explicit user confirmation.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Supported Clouds Section */}
          <section className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Supported cloud providers</h2>
              <p className="text-gray-600 dark:text-gray-400 text-lg max-w-2xl mx-auto">
                Connect unlimited accounts from supported providers.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {/* Google Drive */}
              <div className="p-6 rounded-xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 hover:border-gray-300 dark:hover:border-neutral-700 transition-colors">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                    <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"/>
                    </svg>
                  </div>
                  <span className="font-medium text-sm">Google Drive</span>
                </div>
              </div>

              {/* OneDrive */}
              <div className="p-6 rounded-xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 hover:border-gray-300 dark:hover:border-neutral-700 transition-colors">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center">
                    <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M13.004 3A7 7 0 007.5 7.93a6.5 6.5 0 00-5.41 8.35A6.51 6.51 0 008.6 21h10.905A4.496 4.496 0 0019.504 12c0-.31-.035-.615-.092-.91A7 7 0 0013.004 3z"/>
                    </svg>
                  </div>
                  <span className="font-medium text-sm">OneDrive</span>
                </div>
              </div>

              {/* More coming soon placeholders */}
              <div className="p-6 rounded-xl bg-gray-50 dark:bg-neutral-950 border border-dashed border-gray-300 dark:border-neutral-800">
                <div className="flex flex-col items-center gap-3 opacity-40">
                  <div className="w-12 h-12 rounded-lg bg-gray-200 dark:bg-neutral-800 flex items-center justify-center">
                    <svg className="w-7 h-7 text-gray-400 dark:text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <span className="font-medium text-sm text-gray-500 dark:text-neutral-500">Coming soon</span>
                </div>
              </div>

              <div className="p-6 rounded-xl bg-gray-50 dark:bg-neutral-950 border border-dashed border-gray-300 dark:border-neutral-800">
                <div className="flex flex-col items-center gap-3 opacity-40">
                  <div className="w-12 h-12 rounded-lg bg-gray-200 dark:bg-neutral-800 flex items-center justify-center">
                    <svg className="w-7 h-7 text-gray-400 dark:text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <span className="font-medium text-sm text-gray-500 dark:text-neutral-500">Coming soon</span>
                </div>
              </div>
            </div>
          </section>

          {/* Security & Privacy Section */}
          <section className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Security & privacy first</h2>
              <p className="text-gray-600 dark:text-gray-400 text-lg max-w-2xl mx-auto">
                Your data security and privacy are our top priorities.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Security Feature 1 */}
              <div className="p-8 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-950 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Secure OAuth authentication</h3>
                    <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                      All account connections use industry-standard OAuth 2.0. We never store your passwords, only secure access tokens.
                    </p>
                  </div>
                </div>
              </div>

              {/* Security Feature 2 */}
              <div className="p-8 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Explicit user control</h3>
                    <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                      Every file operation requires your explicit confirmation. No automated syncing or background processes.
                    </p>
                  </div>
                </div>
              </div>

              {/* Security Feature 3 */}
              <div className="p-8 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-950 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Minimal data collection</h3>
                    <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                      We only collect data necessary for the service to function. No tracking, no ads, no selling your data.
                    </p>
                  </div>
                </div>
              </div>

              {/* Security Feature 4 */}
              <div className="p-8 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-950 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Easy account deletion</h3>
                    <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
                      Revoke access anytime from your Google/Microsoft account settings. Request full account deletion via email.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Final CTA Section */}
          <section className="max-w-5xl mx-auto px-6 py-32 text-center">
            <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              Ready to get started?
            </h2>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-8">
              Connect your cloud accounts and manage files from a single, unified dashboard.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-lg bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-100 transition-all duration-200 font-semibold text-lg shadow-lg hover:shadow-xl"
            >
              Get started for free
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </section>

          {/* Footer */}
          <footer className="border-t border-gray-200 dark:border-neutral-800 bg-white/50 dark:bg-black/50 backdrop-blur-sm">
            <div className="max-w-6xl mx-auto px-6 py-12">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                {/* Brand */}
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                    </svg>
                  </div>
                  <span className="font-semibold text-sm">Cloud Aggregator</span>
                </div>

                {/* Links */}
                <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
                  <Link 
                    href="/privacy" 
                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    Privacy
                  </Link>
                  <Link 
                    href="/data-deletion" 
                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    Data deletion
                  </Link>
                  <Link 
                    href="/pricing" 
                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    Pricing
                  </Link>
                  <Link 
                    href="/login" 
                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    Sign in
                  </Link>
                </div>
              </div>

              {/* Copyright */}
              <div className="mt-8 pt-8 border-t border-gray-200 dark:border-neutral-800 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-500">
                  © 2025 Cloud Aggregator. Multi-account cloud storage management.
                </p>
              </div>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
