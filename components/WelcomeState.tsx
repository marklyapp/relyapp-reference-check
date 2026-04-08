'use client'

/**
 * WelcomeState — shown in the chat when no conversation has started yet.
 * Explains what the tool does and provides example inputs.
 */
export default function WelcomeState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-12 text-center">
      {/* Logo / icon */}
      <div className="w-16 h-16 rounded-2xl bg-blue-700 flex items-center justify-center mb-6 shadow-md">
        <span className="text-white text-2xl font-bold">RA</span>
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        RelyApp Reference Check
      </h2>
      <p className="text-gray-500 text-sm max-w-md mb-8 leading-relaxed">
        This tool runs an open-source background reference check on a person
        using publicly available data including court records, regulatory
        databases, social media, and news sources.
      </p>

      {/* What you will need */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 max-w-sm w-full text-left shadow-sm mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          You will be asked for
        </p>
        <ul className="space-y-2 text-sm text-gray-700">
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5 font-semibold">1.</span>
            <span><strong>Full name</strong> e.g. Jane Smith</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5 font-semibold">2.</span>
            <span><strong>Location</strong> e.g. Calgary, AB <em className="text-gray-400">(optional)</em></span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5 font-semibold">3.</span>
            <span><strong>LinkedIn URL</strong> e.g. linkedin.com/in/janesmith <em className="text-gray-400">(optional)</em></span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5 font-semibold">4.</span>
            <span><strong>Employer(s)</strong> e.g. Acme Corp, City of Edmonton <em className="text-gray-400">(optional)</em></span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5 font-semibold">5.</span>
            <span><strong>Usernames / emails</strong> e.g. jsmith@example.com <em className="text-gray-400">(optional)</em></span>
          </li>
        </ul>
      </div>

      {/* Example names */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 max-w-sm w-full text-left">
        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">
          Example subjects
        </p>
        <ul className="space-y-1 text-sm text-blue-800 font-mono">
          <li>John Anderson</li>
          <li>Maria Kowalski</li>
          <li>Robert Chen</li>
        </ul>
      </div>

      <p className="text-xs text-gray-400 mt-8 max-w-xs leading-relaxed">
        Type <strong>skip</strong> for any optional field to continue without it.
        All data is sourced from publicly available records.
      </p>
    </div>
  )
}
