/**
 * Per-language signature quality.
 *
 * Coverage tests prove files are accepted; this proves the extracted signature
 * is actually useful — the right symbols and routes for each stack, which is
 * what the triage pipeline reasons over.
 */
import { describe, expect, it } from "vitest";
import { extractSignature } from "./chunk.js";

describe("backend language signatures", () => {
  it("extracts Python functions, classes and Flask routes", () => {
    const sig = extractSignature(
      "api/checkout.py",
      [
        "from flask import Flask",
        "app = Flask(__name__)",
        "",
        "MAX_RETRIES = 3",
        "",
        "def validate_coupon(code):",
        "    if not code:",
        "        raise ValueError('ERR_COUPON_MISSING')",
        "    return True",
        "",
        "@app.route('/checkout/submit', methods=['POST'])",
        "def submit_order():",
        "    return 'ok'",
        "",
        "class PaymentProcessor:",
        "    def charge(self): pass"
      ].join("\n")
    );
    expect(sig.exportedSymbols).toContain("validate_coupon");
    expect(sig.exportedSymbols).toContain("submit_order");
    expect(sig.exportedSymbols).toContain("PaymentProcessor");
    expect(sig.routePath).toBe("/checkout/submit");
    expect(sig.errorEnums.join(",")).toContain("ERR_COUPON_MISSING");
  });

  it("extracts Go funcs, types and HTTP handlers", () => {
    const sig = extractSignature(
      "cmd/server.go",
      [
        "package main",
        "",
        "const MaxRetries = 3",
        "",
        "type PaymentServer struct {",
        "\tport int",
        "}",
        "",
        "func HandleCheckout(w http.ResponseWriter, r *http.Request) {",
        "\tpanic(\"ERR_HANDLER_STATE\")",
        "}",
        "",
        "func main() {",
        "\thttp.HandleFunc(\"/health\", HandleCheckout)",
        "}"
      ].join("\n")
    );
    expect(sig.exportedSymbols).toContain("HandleCheckout");
    expect(sig.exportedSymbols).toContain("main");
    expect(sig.exportedSymbols).toContain("PaymentServer");
    expect(sig.routePath).toBe("/health");
  });

  it("extracts Rust functions and types", () => {
    const sig = extractSignature(
      "src/cart.rs",
      [
        "pub struct Cart {",
        "    items: Vec<Item>,",
        "}",
        "",
        "pub enum CartError {",
        "    Empty,",
        "}",
        "",
        "pub fn add_item(&self, item: Item) -> Result<(), CartError> {",
        "    todo!()",
        "}",
        "",
        "fn internal_helper() {}"
      ].join("\n")
    );
    expect(sig.exportedSymbols).toContain("add_item");
    expect(sig.exportedSymbols).toContain("Cart");
    expect(sig.exportedSymbols).toContain("CartError");
    expect(sig.exportedSymbols).toContain("internal_helper");
  });

  it("extracts Java classes and Spring mappings", () => {
    const sig = extractSignature(
      "src/main/java/com/acme/OrderController.java",
      [
        "package com.acme;",
        "",
        "public class OrderController {",
        "    @GetMapping(\"/api/orders\")",
        "    public List<Order> list() { return null; }",
        "",
        "    @PostMapping(\"/api/orders\")",
        "    public void create() {}",
        "}"
      ].join("\n")
    );
    expect(sig.exportedSymbols).toContain("OrderController");
    expect(sig.routePath).toBe("/api/orders");
  });

  it("extracts Ruby classes and Rails routes", () => {
    const sig = extractSignature(
      "app/controllers/orders_controller.rb",
      [
        "class OrdersController < ApplicationController",
        "  MAX_LIMIT = 50",
        "  def index",
        "  end",
        "  def create",
        "  end",
        "end",
        "",
        "Rails.application.routes.draw do",
        "  resources :orders",
        "end"
      ].join("\n")
    );
    expect(sig.exportedSymbols).toContain("OrdersController");
    expect(sig.exportedSymbols).toContain("index");
    expect(sig.exportedSymbols).toContain("create");
  });

  it("extracts PHP classes and functions", () => {
    const sig = extractSignature(
      "src/PaymentRepository.php",
      [
        "<?php",
        "namespace App;",
        "",
        "class PaymentRepository {",
        "  public function find($id) {}",
        "}",
        "",
        "function validate_amount($amount) {",
        "  throw new Exception('ERR_AMOUNT_INVALID');",
        "}"
      ].join("\n")
    );
    expect(sig.exportedSymbols).toContain("PaymentRepository");
    expect(sig.exportedSymbols).toContain("validate_amount");
    expect(sig.errorEnums.join(",")).toContain("ERR_AMOUNT_INVALID");
  });

  it("extracts C# types", () => {
    const sig = extractSignature(
      "Services/CheckoutService.cs",
      [
        "namespace Acme.Services {",
        "  public interface ICheckout { }",
        "  public record CheckoutResult(bool Ok);",
        "  public class CheckoutService : ICheckout {",
        "    public void Submit() {}",
        "  }",
        "}"
      ].join("\n")
    );
    expect(sig.exportedSymbols).toContain("ICheckout");
    expect(sig.exportedSymbols).toContain("CheckoutResult");
    expect(sig.exportedSymbols).toContain("CheckoutService");
  });

  it("extracts Express routes", () => {
    const sig = extractSignature(
      "server/routes/users.js",
      [
        "const router = require('express').Router();",
        "",
        "router.get('/api/users', listUsers);",
        "router.post('/api/users', createUser);",
        "",
        "module.exports = router;"
      ].join("\n")
    );
    expect(sig.routePath).toBe("/api/users");
  });

  it("keeps TypeScript behaviour unchanged", () => {
    const sig = extractSignature(
      "src/components/checkout/CouponInput.tsx",
      [
        "export function CouponInput() { return <div className=\"coupon-input\" />; }",
        "export const applyCoupon = () => {};",
        "const ERR_COUPON_STATE_DESYNC = 1;",
        "export default CouponInput;"
      ].join("\n")
    );
    expect(sig.exportedSymbols).toContain("CouponInput");
    expect(sig.exportedSymbols).toContain("applyCoupon");
    expect(sig.classNames).toContain("coupon-input");
    expect(sig.errorEnums.join(",")).toContain("ERR_COUPON_STATE_DESYNC");
  });

  it("produces a useful signature for prose files without inventing symbols", () => {
    const sig = extractSignature(
      "docs/checkout.md",
      "# Checkout\n\nThe coupon box rejects valid codes and locks the cart.\n"
    );
    expect(sig.exportedSymbols).toEqual([]);
    expect(sig.signature).toContain("path:docs/checkout.md");
    expect(sig.description.length).toBeGreaterThan(0);
  });
});