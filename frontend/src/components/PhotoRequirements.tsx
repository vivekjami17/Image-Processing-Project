import { CheckIcon, ChevronIcon } from './icons';

const RULES = [
  'PNG, JPG or HEIC format, up to 20MB.',
  'At least 400×400 pixels.',
  'Sharp and in focus, not blurry.',
  'Exactly one face, clearly visible.',
  'The face should fill at least 15% of the photo height.',
  "Not a near-duplicate of a photo you've already uploaded.",
];

/** Collapsible list of the rules every uploaded photo is checked against. */
export function PhotoRequirements() {
  return (
    <details className="requirements">
      <summary className="requirements__summary">
        <CheckIcon />
        <span>Photo Requirements</span>
        <ChevronIcon />
      </summary>
      <ul className="requirements__list">
        {RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </details>
  );
}
