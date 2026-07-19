/**
 * The Lynceus brand mark — the ringed-almond eye from
 * design/mark/ringed-almond-r1.svg, cropped to the eye itself (no
 * background card) for in-app use on theme surfaces. The app icon is
 * generated separately from design/mark/app-icon-master.svg; keep the
 * two in sync if the mark ever changes. Gradient ids are prefixed so
 * several instances (or other inline SVGs) can coexist in one document.
 */
export function LynceusMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="100 238 824 548"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="mark-lens" cx="42%" cy="31%" r="69%">
          <stop offset="0" stopColor="#414853" />
          <stop offset=".22" stopColor="#252B34" />
          <stop offset=".58" stopColor="#11151B" />
          <stop offset="1" stopColor="#080A0E" />
        </radialGradient>
        <radialGradient id="mark-iris" cx="42%" cy="34%" r="65%">
          <stop offset="0" stopColor="#79C4DA" />
          <stop offset=".32" stopColor="#4DA1C0" />
          <stop offset=".72" stopColor="#2F7B9E" />
          <stop offset="1" stopColor="#173E54" />
        </radialGradient>
        <radialGradient id="mark-pupil" cx="40%" cy="31%" r="75%">
          <stop offset="0" stopColor="#232832" />
          <stop offset=".52" stopColor="#0C0F14" />
          <stop offset="1" stopColor="#030405" />
        </radialGradient>
        <filter id="mark-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
      </defs>
      <path
        d="M116 512C221 319 355 254 512 254C669 254 803 319 908 512C803 705 669 770 512 770C355 770 221 705 116 512Z"
        fill="url(#mark-lens)"
      />
      <path
        d="M138 512C238 339 363 278 512 278C661 278 786 339 886 512C786 685 661 746 512 746C363 746 238 685 138 512Z"
        fill="none"
        stroke="#8F9AA8"
        strokeOpacity=".16"
        strokeWidth="9"
      />
      <ellipse
        cx="393"
        cy="379"
        rx="136"
        ry="61"
        fill="#EFFAFF"
        opacity=".18"
        filter="url(#mark-soft)"
        transform="rotate(-22 393 379)"
      />
      <ellipse
        cx="398"
        cy="366"
        rx="86"
        ry="27"
        fill="#FFFFFF"
        opacity=".27"
        transform="rotate(-22 398 366)"
      />
      <ellipse cx="512" cy="512" rx="201" ry="201" fill="#071219" opacity=".82" />
      <circle cx="512" cy="512" r="184" fill="url(#mark-iris)" />
      <circle cx="512" cy="512" r="118" fill="url(#mark-pupil)" />
      <ellipse
        cx="470"
        cy="467"
        rx="37"
        ry="22"
        fill="#C4F1FB"
        opacity=".22"
        transform="rotate(-35 470 467)"
      />
      <circle
        cx="512"
        cy="512"
        r="207"
        fill="none"
        stroke="#8DCFE4"
        strokeOpacity=".13"
        strokeWidth="8"
      />
    </svg>
  );
}
