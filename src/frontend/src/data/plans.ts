/** Pricing tiers, the comparison matrix, and the FAQ — one source of truth. */

export interface Plan {
  id: "hobby" | "freelancer" | "agency";
  tier: string;
  price: string;
  per: string;
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
    featured: false,
    cta: "Start free",
    to: "/demo",
    tagline: "One staging site, public repos, no account setup.",
    features: [
      "1 staging link",
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
    per: "per month, per staging site",
    featured: true,
    cta: "Wire your staging site",
    to: "/demo",
    tagline: "Private repos and model-drafted issues for one client site.",
    features: [
      "1 staging link per paid slot",
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
    per: "per month · 4 staging links",
    featured: false,
    cta: "Talk to us",
    to: "/demo",
    tagline: "Four client sites, each with its own repo and sign-in.",
    features: [
      "4 staging links included",
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
  { feature: "Staging links", hobby: "1", freelancer: "1 per slot", agency: "4" },
  { feature: "Public repositories", hobby: "Included", freelancer: "Included", agency: "Included" },
  { feature: "Private repositories", hobby: null, freelancer: "Included", agency: "Included" },
  { feature: "Spoken confirmation", hobby: "Browser voice", freelancer: "Premium voice", agency: "Premium voice" },
  { feature: "Issue drafting", hobby: "Offline engine", freelancer: "Model-drafted", agency: "Model-drafted" },
  { feature: "Suspected-file matching", hobby: "Keyword", freelancer: "Vector + keyword", agency: "Vector + keyword" },
  { feature: "Re-index on push", hobby: null, freelancer: "Automatic", agency: "Automatic" },
  { feature: "Issue published as", hobby: "Your sign-in", freelancer: "Your sign-in", agency: "Each client's sign-in" },
  { feature: "Support", hobby: "Community", freelancer: "Email", agency: "Priority" }
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What counts as a staging link?",
    a: "One embeddable widget installation on one client site. Each link is an independent project with its own repository, its own architecture index, and its own issue log — so clients never see each other's work."
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