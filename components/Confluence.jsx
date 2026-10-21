// Decorative interpretation of the Nile confluence, not a geographic map.
export default function Confluence({ className }) {
  return <svg className={className} viewBox="0 0 400 280" fill="none" aria-hidden="true" focusable="false">
    <g stroke="currentColor" strokeWidth="2">
      <path d="M100 280C100 210 175 200 198 142S180 50 225 0" />
      <path d="M120 280C120 215 190 210 212 150S196 45 240 0" />
      <path d="M400 240C320 240 300 170 212 150" />
      <path d="M400 220C330 220 305 150 198 142" />
      <path d="M84 280C82 210 157 190 182 135S165 55 210 0" opacity=".35" />
      <path d="M400 258C315 258 285 187 226 160S215 50 255 0" opacity=".35" />
    </g>
    <circle cx="205" cy="146" r="5" fill="currentColor" />
  </svg>
}
