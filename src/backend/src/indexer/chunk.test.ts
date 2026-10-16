import { describe, it, expect } from "vitest";
import { extractSignature, isIndexableFile, baseComponentName } from "./chunk.js";

const tsxSource = `/**
 * Coupon entry field for the checkout route.
 */
import { useState } from "react";

export const ERR_COUPON_STATE_DESYNC = "ERR_COUPON_STATE_DESYNC";

export function CouponInput({ onApplied }) {
  async function onApply() {
    const promo = await validatePromoCode(code);
    const discount = promo.discountPct;
  }
  return (
    <div className="coupon-input">
      <input className="coupon-field" aria-label="Promotional code" />
      <a href="/checkout">redo</a>
    </div>
  );
}

export default CouponInput;
`;

describe("extractSignature", () => {
  it("extracts exported symbols", () => {
    const sig = extractSignature("src/components/checkout/CouponInput.tsx", tsxSource);
    expect(sig.exportedSymbols).toContain("CouponInput");
    expect(sig.componentName).toBe("CouponInput");
  });

  it("extracts screaming-snake error codes", () => {
    const sig = extractSignature("src/components/checkout/CouponInput.tsx", tsxSource);
    expect(sig.errorEnums).toContain("ERR_COUPON_STATE_DESYNC");
  });

  it("extracts className tokens", () => {
    const sig = extractSignature("src/components/checkout/CouponInput.tsx", tsxSource);
    expect(sig.classNames).toContain("coupon-input");
    expect(sig.classNames).toContain("coupon-field");
  });

  it("extracts route literals", () => {
    const sig = extractSignature("src/components/checkout/CouponInput.tsx", tsxSource);
    expect(sig.routes).toContain("/checkout");
  });

  it("serializes a compact signature containing path and exports", () => {
    const sig = extractSignature("src/components/checkout/CouponInput.tsx", tsxSource);
    expect(sig.signature).toContain("path:src/components/checkout/CouponInput.tsx");
    expect(sig.signature).toContain("component:CouponInput");
    expect(sig.description).toContain("CouponInput");
  });

  it("handles CSS files via selector extraction", () => {
    const css = `.checkout-form { display: grid; }\n.coupon-error { color: red; }`;
    const sig = extractSignature("src/styles/checkout.css", css);
    expect(sig.classNames).toContain("checkout-form");
    expect(sig.classNames).toContain("coupon-error");
    expect(sig.exportedSymbols).toHaveLength(0);
  });

  it("never throws on arbitrary junk input", () => {
    expect(() => extractSignature("weird/\0file.ts", "\0\0\ufffd\ufffd{{{")).not.toThrow();
  });
});

describe("isIndexableFile", () => {
  it("accepts source files", () => {
    expect(isIndexableFile("src/a.ts", 100)).toBe(true);
    expect(isIndexableFile("src/a.tsx", 100)).toBe(true);
    expect(isIndexableFile("styles/main.css", 100)).toBe(true);
  });

  it("rejects binaries, lockfiles, skipped dirs, and oversized files", () => {
    expect(isIndexableFile("assets/logo.png", 100)).toBe(false);
    expect(isIndexableFile("package-lock.json", 100)).toBe(false);
    expect(isIndexableFile("node_modules/lib/index.js", 100)).toBe(false);
    expect(isIndexableFile("dist/bundle.js", 100)).toBe(false);
    expect(isIndexableFile("huge.ts", 500 * 1024)).toBe(false);
  });
});

describe("baseComponentName", () => {
  it("strips the extension only", () => {
    expect(baseComponentName("src/x/CouponInput.tsx")).toBe("CouponInput");
    expect(baseComponentName("api.coupon.ts")).toBe("api.coupon");
  });
});
