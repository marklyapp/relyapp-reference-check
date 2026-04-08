'use client'

interface WelcomeStateProps {
  onStart: () => void
}

export default function WelcomeState({ onStart }: WelcomeStateProps) {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-700 flex items-center justify-center">
              <span className="text-white text-sm font-bold">RA</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900 leading-tight">
                RelyApp Reference Check
              </h1>
              <p className="text-xs text-gray-500">Government of Alberta</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border bg-green-50 text-green-700 border-green-200">
            <span className="w-1.5 h-1.5 rounded-full inline-block bg-green-500" />
            Online
          </span>
        </div>
      </header>

      {/* Welcome content */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center px-4 py-12">
        <div className="max-w-xl w-full text-center">
          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl bg-blue-700 flex items-center justify-center mx-auto mb-6 shadow-md">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="white"
              className="w-8 h-8"
            >
              <path
                fillRule="evenodd"
                d="M10.5 3.75a6.75 6.75 0 100 13.5 6.75 6.75 0 000-13.5zM2.25 10.5a8.25 8.25 0 1114.59 5.28l4.69 4.69a.75.75 0 11-1.06 1.06l-4.69-4.69A8.25 8.25 0 012.25 10.5z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Reference Check Tool
          </h2>
          <p className="text-gray-500 text-sm mb-8 leading-relaxed max-w-sm mx-auto">
            Search public records, social media, professional registries, court databases,
            and election disclosures to generate a comprehensive background reference report.
          </p>

          {/* What you'll need */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6 text-left">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
              What you'll need
            </h3>
            <ul className="space-y-2.5 text-sm text-gray-600">
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold mt-0.5">1</span>
                <span><strong>Subject's full name</strong> — e.g. <code className="bg-gray-100 px-1 rounded text-xs">Jane Smith</code> or <code className="bg-gray-100 px-1 rounded text-xs">Robert A. Johnson</code></span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold mt-0.5">2</span>
                <span><strong>Location</strong> (optional) — e.g. <code className="bg-gray-100 px-1 rounded text-xs">Calgary, AB</code></span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold mt-0.5">3</span>
                <span><strong>LinkedIn URL</strong> (optional) — e.g. <code className="bg-gray-100 px-1 rounded text-xs">linkedin.com/in/janesmith</code></span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold mt-0.5">4</span>
                <span><strong>Known employers or organizations</strong> (optional)</span>
              </li>
            </ul>
          </div>

          {/* Example use cases */}
          <div className="bg-blue-50 rounded-2xl border border-blue-100 p-5 mb-8 text-left">
            <h3 className="text-sm font-semibold text-blue-800 mb-2">Example checks</h3>
            <ul className="space-y-1.5 text-xs text-blue-700">
              <li>• Pre-employment background check for a contractor</li>
              <li>• Verifying a volunteer's public record</li>
              <li>• Board member or executive due diligence</li>
              <li>• Political contribution and court record lookup</li>
            </ul>
          </div>

          {/* Start button */}
          <button
            onClick={onStart}
            className="w-full sm:w-auto px-8 py-3.5 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Start a reference check
          </button>

          <p className="text-xs text-gray-400 mt-6">
            Government of Alberta — RelyApp Reference Check
          </p>
        </div>
      </div>
    </div>
  )
}
