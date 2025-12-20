export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white shadow-sm rounded-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Terms of Service</h1>
        
        <p className="text-sm text-gray-600 mb-6">
          <strong>Effective Date:</strong> December 19, 2025
        </p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Acceptance of Terms</h2>
          <p className="text-gray-700 mb-4">
            By accessing or using Cloud Aggregator ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.
          </p>
          <p className="text-gray-700 mb-4">
            We reserve the right to update these Terms at any time. Your continued use of the Service after changes are posted constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Description of Service</h2>
          <p className="text-gray-700 mb-4">
            Cloud Aggregator is a SaaS application that allows you to:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>Connect multiple Google Drive accounts through OAuth authentication</li>
            <li>View and navigate files across connected accounts</li>
            <li>Copy files between your connected Google Drive accounts</li>
            <li>Rename files in your connected accounts</li>
            <li>Download files from your connected accounts</li>
            <li>Detect duplicate files to avoid redundant copies</li>
          </ul>
          <p className="text-gray-700 mt-4">
            The Service operates exclusively on your explicit instructions and does not automatically access, modify, or transfer your files.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. Account Registration and Access</h2>
          <p className="text-gray-700 mb-4">
            <strong>3.1 OAuth Authentication:</strong> Access to the Service is granted only after you provide explicit consent through Google's OAuth 2.0 authentication flow. By authenticating, you authorize Cloud Aggregator to access your Google Drive data as described in our Privacy Policy.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>3.2 Account Security:</strong> You are responsible for maintaining the confidentiality of your authentication credentials. You agree to notify us immediately of any unauthorized access to your account.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>3.3 Revocation:</strong> You may revoke Cloud Aggregator's access to your Google Drive data at any time through your{' '}
            <a 
              href="https://myaccount.google.com/permissions" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Google Account permissions page
            </a>. Revoking access will terminate your ability to use the Service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Service Plans and Quotas</h2>
          <p className="text-gray-700 mb-4">
            <strong>4.1 Free Tier:</strong> The free tier includes a monthly quota of copy operations. Quota limits are enforced to ensure fair usage and service stability.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>4.2 Rate Limits:</strong> To protect service infrastructure, rate limits are applied to copy operations. Exceeding rate limits will result in temporary request throttling.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>4.3 Quota Reset:</strong> Monthly quotas reset on the first day of each calendar month based on UTC time.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>4.4 Duplicate Detection:</strong> Detected duplicate files do not consume your copy quota and are not rate-limited.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. User Responsibilities</h2>
          <p className="text-gray-700 mb-4">You agree to:</p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>Use the Service only for lawful purposes and in compliance with these Terms</li>
            <li>Not attempt to circumvent quota limits, rate limits, or security measures</li>
            <li>Not use the Service to store, share, or transmit illegal, harmful, or offensive content</li>
            <li>Not interfere with or disrupt the Service or servers or networks connected to the Service</li>
            <li>Not attempt to gain unauthorized access to any portion of the Service</li>
            <li>Ensure you have the necessary rights and permissions for any files you copy or transfer</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Prohibited Uses</h2>
          <p className="text-gray-700 mb-4">You may not use the Service to:</p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>Violate any local, state, national, or international law</li>
            <li>Infringe upon or violate intellectual property rights of others</li>
            <li>Transmit any viruses, malware, or other malicious code</li>
            <li>Engage in any automated use of the system, such as scraping or data mining without authorization</li>
            <li>Impersonate any person or entity or falsely state or misrepresent your affiliation</li>
            <li>Attempt to reverse engineer, decompile, or disassemble any aspect of the Service</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Service Availability</h2>
          <p className="text-gray-700 mb-4">
            <strong>7.1 Uptime:</strong> While we strive to provide reliable service, we do not guarantee uninterrupted or error-free operation. The Service may be unavailable due to maintenance, updates, or circumstances beyond our control.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>7.2 Modifications:</strong> We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time, with or without notice.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>7.3 Third-Party Dependencies:</strong> The Service relies on Google Drive API and other third-party services. Changes or disruptions to these services may affect Service availability or functionality.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Data and Privacy</h2>
          <p className="text-gray-700 mb-4">
            <strong>8.1 Data Processing:</strong> Your use of the Service is also governed by our Privacy Policy, which is incorporated into these Terms by reference.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>8.2 User Data:</strong> You retain all rights to your data. We do not claim ownership of any content you access through the Service.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>8.3 Backups:</strong> You are responsible for maintaining backups of your important data. We are not responsible for data loss resulting from your use of the Service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Intellectual Property</h2>
          <p className="text-gray-700 mb-4">
            <strong>9.1 Service Ownership:</strong> The Service, including its design, code, features, and functionality, is owned by Cloud Aggregator and is protected by copyright, trademark, and other intellectual property laws.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>9.2 Limited License:</strong> Subject to these Terms, we grant you a limited, non-exclusive, non-transferable license to access and use the Service for your personal or internal business purposes.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>9.3 Trademarks:</strong> "Cloud Aggregator" and related logos are trademarks. You may not use these marks without our prior written permission.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Disclaimer of Warranties</h2>
          <p className="text-gray-700 mb-4 uppercase font-semibold">
            The service is provided "as is" and "as available" without warranties of any kind, either express or implied.
          </p>
          <p className="text-gray-700 mb-4">
            We disclaim all warranties, including but not limited to:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>Warranties of merchantability, fitness for a particular purpose, and non-infringement</li>
            <li>Warranties that the Service will be uninterrupted, error-free, or secure</li>
            <li>Warranties regarding the accuracy, reliability, or completeness of any content or data</li>
          </ul>
          <p className="text-gray-700 mt-4">
            Some jurisdictions do not allow the exclusion of certain warranties, so some of the above exclusions may not apply to you.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">11. Limitation of Liability</h2>
          <p className="text-gray-700 mb-4 uppercase font-semibold">
            To the maximum extent permitted by law, Cloud Aggregator shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses.
          </p>
          <p className="text-gray-700 mb-4">
            This limitation applies to:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>Errors, mistakes, or inaccuracies in the Service</li>
            <li>Personal injury or property damage resulting from your use of the Service</li>
            <li>Unauthorized access to or use of our servers or any personal information stored therein</li>
            <li>Interruption or cessation of the Service</li>
            <li>Bugs, viruses, or other harmful code transmitted through the Service</li>
            <li>Loss or damage to your files or data</li>
          </ul>
          <p className="text-gray-700 mt-4">
            Our total liability to you for any claims arising from or relating to these Terms or the Service shall not exceed the amount you have paid us in the twelve (12) months preceding the claim, or $100, whichever is greater.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">12. Indemnification</h2>
          <p className="text-gray-700 mb-4">
            You agree to indemnify, defend, and hold harmless Cloud Aggregator, its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses, including reasonable attorneys' fees, arising out of or in any way connected with:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
            <li>Your access to or use of the Service</li>
            <li>Your violation of these Terms</li>
            <li>Your violation of any third-party rights, including intellectual property, privacy, or publicity rights</li>
            <li>Any content you submit, post, or transmit through the Service</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">13. Termination</h2>
          <p className="text-gray-700 mb-4">
            <strong>13.1 By You:</strong> You may terminate your use of the Service at any time by revoking Cloud Aggregator's access through your Google Account permissions.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>13.2 By Us:</strong> We may suspend or terminate your access to the Service at any time, with or without cause, with or without notice, for any reason including violation of these Terms.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>13.3 Effect of Termination:</strong> Upon termination, your right to use the Service will immediately cease. We may delete your account data in accordance with our data retention policies.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">14. Governing Law and Disputes</h2>
          <p className="text-gray-700 mb-4">
            <strong>14.1 Governing Law:</strong> These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which Cloud Aggregator operates, without regard to its conflict of law provisions.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>14.2 Dispute Resolution:</strong> Any disputes arising from these Terms or the Service shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association, except where prohibited by law.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>14.3 Class Action Waiver:</strong> You agree to bring claims against us only in your individual capacity and not as part of any class or representative action.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">15. General Provisions</h2>
          <p className="text-gray-700 mb-4">
            <strong>15.1 Entire Agreement:</strong> These Terms, together with our Privacy Policy, constitute the entire agreement between you and Cloud Aggregator regarding the Service.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>15.2 Severability:</strong> If any provision of these Terms is found to be invalid or unenforceable, the remaining provisions will remain in full force and effect.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>15.3 Waiver:</strong> No waiver of any term of these Terms shall be deemed a further or continuing waiver of such term or any other term.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>15.4 Assignment:</strong> You may not assign or transfer these Terms or your rights under these Terms without our prior written consent. We may assign these Terms without restriction.
          </p>
          <p className="text-gray-700 mb-4">
            <strong>15.5 Force Majeure:</strong> We shall not be liable for any failure to perform our obligations under these Terms due to circumstances beyond our reasonable control.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">16. Contact Information</h2>
          <p className="text-gray-700 mb-4">
            If you have any questions about these Terms of Service, please contact us at:
          </p>
          <p className="text-gray-700">
            <strong>Email:</strong> legal@cloudaggregator.com
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">17. Acknowledgment</h2>
          <p className="text-gray-700 mb-4">
            By using Cloud Aggregator, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
          </p>
        </section>

        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-600 text-center">
            Last updated: December 19, 2025
          </p>
        </div>
      </div>
    </div>
  );
}
