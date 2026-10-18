/** Pricing tiers, the comparison matrix, and the FAQ — one source of truth. */

export interface Plan {
  id: "hobby" | "freelancer" | "agency";
  tier: string;
  price: string;
  per: string;
  /** Whole cents, mirrors the server-side price so checkout never re-parses text. */
  amountCents: number;
  featured: boolean;
  cta: string;
  to: string;
  /** One line on who this is for, shown under the price. */
  tagline: string;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "hobby",
    tier: "Hobby",
    price: "$0",
    per: "forever",
    amountCents: 0,
    featured: false,
    cta: "Start free",
    to: "/demo",
    tagline: "One client project, public repos, no account setup.",
    features: [
      "1 project",
      "Public repositories",
      "Browser voice confirmation",
      "Deterministic issue drafting",
      "Issue drafts saved to your dashboard"
    ]
  },
  {
    id: "freelancer",
    tier: "Freelancer",
    price: "$15",
    per: "per month, per project",
    amountCents: 1500,
    featured: true,
    cta: "Connect your project",
    to: "/demo",
    tagline: "Private repos and model-drafted issues for one client project.",
    features: [
      "1 project per paid slot",
      "Private repositories",
      "Premium synthesized confirmation voice",
      "Model-drafted issues with file matching",
      "Automatic re-index on every push"
    ]
  },
  {
    id: "agency",
    tier: "Agency",
    price: "$60",
    per: "per month · 10 projects",
    amountCents: 6000,
    featured: false,
    cta: "Talk to us",
    to: "/demo",
    tagline: "Ten client projects, each with its own repo and sign-in.",
    features: [
      "10 projects included",
      "Separate repository per client",
      "Sign-in per client, issues authored by you",
      "Everything in Freelancer",
      "Priority support"
    ]
  }
];

/**
 * Comparison rows. `null` means the capability is not part of that tier.
 * Values describe behaviour the product actually performs, not aspirational
 * switches — every user currently receives the same capabilities, and the tiers
 * differ in what the deployment is configured to unlock.
 */
export interface ComparisonRow {
  feature: string;
  hobby: string | null;
  freelancer: string | null;
  agency: string | null;
}

export const COMPARISON: ComparisonRow[] = [
  { feature: "Projects", hobby: "1", freelancer: "1 per slot", agency: "10" },
  { feature: "Public repositories", hobby: "Included", freelancer: "Included", agency: "Included" },
  { feature: "Private repositories", hobby: null, freelancer: "Included", agency: "Included" },
  { feature: "Spoken confirmation", hobby: "Browser voice", freelancer: "Premium voice", agency: "Premium voice" },
  { feature: "Issue drafting", hobby: "Offline engine", freelancer: "Model-drafted", agency: "Model-drafted" },
  { feature: "Hybrid file matching", hobby: "Included", freelancer: "Included", agency: "Included" },
  { feature: "Re-index on push", hobby: null, freelancer: "Automatic", agency: "Automatic" },
  { feature: "Issue published as", hobby: "Your sign-in", freelancer: "Your sign-in", agency: "Each client's sign-in" },
  { feature: "Support", hobby: "Community", freelancer: "Email", agency: "Priority" }
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What counts as a project?",
    a: "One project is one client site with the widget installed. Each project keeps its own repository, its own architecture index, and its own issue log — so one client's reports never appear in another's repo."
  },
  {
    q: "Do I need to configure anything to start?",
    a: "No. Create a project, paste its repository, and install the snippet. Every external service has a documented local fallback, so the pipeline runs end to end with nothing configured and upgrades one step at a time as you add keys."
  },
  {
    q: "How does the free tier behave differently?",
    a: "Hobby runs the complete pipeline: capture, transcription, file matching, drafting and confirmation. The drafting step uses the built-in offline engine instead of a hosted model, and confirmation uses your browser's voice. Everything still produces a finished, filed issue."
  },
  {
    q: "What happens when a service is unavailable?",
    a: "Every station degrades independently. If drafting fails, the offline engine finishes the draft. If publishing is not possible, the issue is kept as a complete dashboard draft with the reason shown. No report is ever dropped or silently lost."
  },
  {
    q: "Who owns the data in my reports?",
    a: "You do. Every report is filed under the GitHub account that signed in, and reports are visible only to that account and the deployment owner. Issues land in your repository — not ours."
  },
  {
    q: "Can I run this myself?",
    a: "Yes. It is Apache-2.0 licensed and ships as a single container image sized for small hosting. Self-hosting means your client's audio, transcripts and telemetry never leave infrastructure you control."
  }
];