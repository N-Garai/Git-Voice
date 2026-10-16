/** Shared pricing tiers — used by the landing teaser and the full pricing page. */

export interface Plan {
  id: string;
  tier: string;
  price: string;
  per: string;
  featured: boolean;
  cta: string;
  to: string;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "hobby",
    tier: "Hobby",
    price: "$0",
    per: "/forever",
    featured: false,
    cta: "Start free",
    to: "/demo",
    features: [
      "1 project staging link",
      "10 issues / month",
      "Browser voice confirmation",
      "Offline drafting engine",
      "Community support"
    ]
  },
  {
    id: "freelancer",
    tier: "Freelancer",
    price: "$15",
    per: "/month per project",
    featured: true,
    cta: "Wire your staging site",
    to: "/demo",
    features: [
      "Unlimited issues",
      "Premium synthesized voice",
      "Model-drafted issues",
      "Auto re-index on every push",
      "Draft review before publishing",
      "Email support"
    ]
  },
  {
    id: "agency",
    tier: "Agency",
    price: "$60",
    per: "/month · 4 projects",
    featured: false,
    cta: "Talk to us",
    to: "/demo",
    features: [
      "Everything in Freelancer",
      "4 staging links included",
      "Per-client issue routing",
      "pgvector index backend",
      "Priority support"
    ]
  }
];
