'use strict'

const { ipcRenderer } = require('electron')

const UPDATE_NAV_ID = 'dsh-desktop-update-nav'
const UPDATE_SECTION_ID = 'dsh-desktop-update-section'
const USAGE_NAV_ID = 'dsh-desktop-usage-nav'
const USAGE_SECTION_ID = 'dsh-desktop-usage-section'
const RECHARGE_DIALOG_ID = 'dsh-desktop-recharge-dialog'
const LOW_BALANCE_TOAST_ID = 'dsh-desktop-low-balance-toast'
const PRICE_BAND_BANNER_ID = 'dsh-desktop-price-band-banner'
const CUSTOM_NAV_IDS = new Set([UPDATE_NAV_ID, USAGE_NAV_ID])
const CUSTOM_SECTION_IDS = new Set([UPDATE_SECTION_ID, USAGE_SECTION_ID])
const wiredNativeButtons = new WeakSet()
let syncQueued = false
let cachedVersions = { desktopVersion: null, currentVersion: null, desktopUpdateSupported: true }
let cachedStatus = {
  desktop: { text: '尚未检查应用更新', tone: 'muted' },
  kernel: { text: '尚未检查内核更新', tone: 'muted' },
}
let cachedBalance = null
let paymentPollTimer = null
let priceBandTimer = null
let priceBandSyncTimer = null
let priceBandRequestPending = false

function installStyles() {
  if (document.getElementById('dsh-desktop-update-styles')) return
  const style = document.createElement('style')
  style.id = 'dsh-desktop-update-styles'
  style.textContent = `
    #${UPDATE_NAV_ID}[aria-current="true"], #${USAGE_NAV_ID}[aria-current="true"] {
      background: var(--dsw-specific-sidebar-nav-item-active, rgba(128, 138, 152, .24));
    }
    #${USAGE_NAV_ID}[data-low-balance="true"]::after {
      content: ''; width: 7px; height: 7px; margin-left: auto; border-radius: 999px;
      background: #f97316; box-shadow: 0 0 0 3px rgba(249,115,22,.16);
    }
    #${PRICE_BAND_BANNER_ID} {
      position: relative; display: inline-flex; flex: none; align-items: center; gap: 6px;
      width: auto; max-width: min(460px, calc(100vw - 430px)); min-height: 22px; box-sizing: border-box;
      margin-left: 8px; padding: 2px 8px; overflow: hidden;
      border: 1px solid rgba(96,165,250,.38); border-radius: 999px;
      color: #bfdbfe; background: rgba(30,58,95,.68); pointer-events: none;
      font-family: inherit; font-size: 12px; font-weight: 400; line-height: 18px;
      letter-spacing: normal; white-space: nowrap;
    }
    #${PRICE_BAND_BANNER_ID}[hidden] { display: none; }
    #${PRICE_BAND_BANNER_ID}[data-band="peak"] {
      border-color: rgba(245,158,11,.5); color: #fde68a; background: rgba(92,55,12,.9);
    }
    #${PRICE_BAND_BANNER_ID} .dsh-price-band-dot {
      width: 7px; height: 7px; flex: none; border-radius: 999px;
      background: #60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,.14);
    }
    #${PRICE_BAND_BANNER_ID}[data-band="peak"] .dsh-price-band-dot {
      background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.16);
    }
    #${PRICE_BAND_BANNER_ID} strong { color: inherit; font-size: inherit; font-weight: 500; }
    #${PRICE_BAND_BANNER_ID} [data-field="detail"] { opacity: .9; }
    #${PRICE_BAND_BANNER_ID} [data-field="countdown"] {
      margin-left: 2px; padding-left: 7px; overflow: hidden; border-left: 1px solid currentColor;
      opacity: .82; text-overflow: ellipsis;
    }
    @media (max-width: 760px) {
      #${PRICE_BAND_BANNER_ID} { max-width: 250px; }
      #${PRICE_BAND_BANNER_ID} [data-field="detail"] { display: none; }
    }
    #${UPDATE_SECTION_ID} {
      flex: 1; min-height: 0; overflow-y: auto; box-sizing: border-box;
      padding: 0 24px 24px; color: var(--dsw-alias-label-primary, #e7e9ed);
      font-family: inherit;
    }
    #${UPDATE_SECTION_ID}[hidden] { display: none; }
    #${UPDATE_SECTION_ID} .dsh-update-heading {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 24px; padding: 8px 0 22px;
    }
    #${UPDATE_SECTION_ID} h2 {
      margin: 0 0 7px; font-size: 20px; line-height: 28px; font-weight: 600;
    }
    #${UPDATE_SECTION_ID} p {
      margin: 0; color: var(--dsw-alias-label-secondary, #a7abb4);
      font-size: 13px; line-height: 20px;
    }
    #${UPDATE_SECTION_ID} .dsh-update-desktop-version {
      flex: none; margin-top: 3px; padding: 5px 10px; border-radius: 999px;
      background: var(--dsw-alias-bg-layer-1, rgba(128, 138, 152, .14));
      color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 12px;
    }
    #${UPDATE_SECTION_ID} .dsh-update-card {
      padding: 20px; border: 1px solid var(--dsw-alias-stroke-secondary, rgba(128,138,152,.24));
      border-radius: 16px; background: var(--dsw-alias-bg-layer-1, rgba(128,138,152,.08));
    }
    #${UPDATE_SECTION_ID} .dsh-update-card + .dsh-update-card { margin-top: 12px; }
    #${UPDATE_SECTION_ID} .dsh-update-row {
      display: flex; align-items: center; justify-content: space-between; gap: 18px;
    }
    #${UPDATE_SECTION_ID} .dsh-update-label { font-size: 14px; font-weight: 500; }
    #${UPDATE_SECTION_ID} .dsh-update-version {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 13px;
    }
    #${UPDATE_SECTION_ID} .dsh-update-status {
      min-height: 20px; margin-top: 14px; padding-top: 14px;
      border-top: 1px solid var(--dsw-alias-stroke-secondary, rgba(128,138,152,.2));
      color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 13px; line-height: 20px;
      overflow-wrap: anywhere;
    }
    #${UPDATE_SECTION_ID} .dsh-update-status[data-tone="error"] { color: #f87171; }
    #${UPDATE_SECTION_ID} .dsh-update-status[data-tone="success"] { color: #4ade80; }
    #${UPDATE_SECTION_ID} .dsh-update-actions {
      display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;
    }
    #${UPDATE_SECTION_ID} button {
      min-height: 36px; padding: 7px 14px; border-radius: 10px;
      border: 1px solid var(--dsw-alias-stroke-secondary, rgba(255,255,255,.16));
      color: var(--dsw-alias-label-primary, #eef4ff);
      background: var(--dsw-alias-bg-layer-1, #3a3b3f); cursor: pointer;
      font: 13px/20px inherit;
    }
    #${UPDATE_SECTION_ID} button:hover { filter: brightness(1.08); }
    #${UPDATE_SECTION_ID} button.primary { border-color: #2563eb; background: #2563eb; color: white; }
    #${UPDATE_SECTION_ID} button:disabled { opacity: .55; cursor: wait; filter: none; }
    #${USAGE_SECTION_ID} {
      container: dsh-usage-page / inline-size; flex: 1; min-height: 0; overflow-y: auto; box-sizing: border-box;
      padding: 0 16px 6px; color: var(--dsw-alias-label-primary, #e7e9ed);
      font-family: inherit;
    }
    #${USAGE_SECTION_ID}[hidden] { display: none; }
    #${USAGE_SECTION_ID} .dsh-usage-heading {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; padding: 4px 0 10px;
    }
    #${USAGE_SECTION_ID} h2 { margin: 0 0 2px; font-size: 18px; line-height: 24px; font-weight: 600; }
    #${USAGE_SECTION_ID} p {
      margin: 0; color: var(--dsw-alias-label-secondary, #a7abb4);
      font-size: 11px; line-height: 16px;
    }
    #${USAGE_SECTION_ID} button {
      flex: none; min-height: 30px; padding: 4px 10px; border-radius: 8px;
      border: 1px solid var(--dsw-alias-stroke-secondary, rgba(255,255,255,.16));
      color: var(--dsw-alias-label-primary, #eef4ff);
      background: var(--dsw-alias-bg-layer-1, #3a3b3f); cursor: pointer;
      font: 11px/18px inherit;
    }
    #${USAGE_SECTION_ID} button:hover { filter: brightness(1.08); }
    #${USAGE_SECTION_ID} button:disabled { opacity: .55; cursor: wait; filter: none; }
    #${USAGE_SECTION_ID} button.primary { border-color: #2563eb; background: #2563eb; color: white; }
    #${USAGE_SECTION_ID} .dsh-usage-actions {
      display: flex; align-items: center; justify-content: flex-end; gap: 8px;
      flex-wrap: wrap;
    }
    #${USAGE_SECTION_ID} .dsh-refresh-result {
      max-width: 230px; color: var(--dsw-alias-label-secondary, #a7abb4);
      font-size: 10px; line-height: 15px; text-align: right;
    }
    #${USAGE_SECTION_ID} .dsh-refresh-result[data-tone="success"] { color: #4ade80; }
    #${USAGE_SECTION_ID} .dsh-refresh-result[data-tone="error"] { color: #f87171; }
    #${USAGE_SECTION_ID} .dsh-usage-tabs {
      display: inline-flex; gap: 3px; margin: 0 0 8px; padding: 3px;
      border-radius: 9px; background: var(--dsw-alias-bg-layer-1, rgba(128,138,152,.1));
    }
    #${USAGE_SECTION_ID} .dsh-usage-tabs button {
      min-height: 26px; padding: 3px 10px; border-color: transparent; background: transparent;
    }
    #${USAGE_SECTION_ID} .dsh-usage-tabs button[aria-selected="true"] {
      background: var(--dsw-specific-sidebar-nav-item-active, rgba(128,138,152,.24));
    }
    #${USAGE_SECTION_ID} [data-pane][hidden] { display: none; }
    #${USAGE_SECTION_ID} .dsh-top-up-shell {
      min-height: 580px; overflow: hidden; border: 1px solid var(--dsw-alias-stroke-secondary, rgba(128,138,152,.24));
      border-radius: 14px; background: #111214;
    }
    #${USAGE_SECTION_ID} .dsh-top-up-toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 10px 12px; border-bottom: 1px solid rgba(128,138,152,.2);
      color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 12px;
    }
    #${USAGE_SECTION_ID} .dsh-top-up-toolbar button { min-height: 30px; padding: 4px 10px; }
    #${USAGE_SECTION_ID} webview[data-field="top-up-webview"] {
      display: flex; width: 100%; height: 610px; background: #111214;
    }
    #${USAGE_SECTION_ID} .dsh-top-up-help {
      margin-top: 10px; color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 11px; line-height: 18px;
    }
    #${USAGE_SECTION_ID} .dsh-native-recharge { max-width: 720px; padding: 2px 2px 24px; }
    #${USAGE_SECTION_ID} .dsh-native-recharge h3 { margin: 0 0 12px; font-size: 18px; line-height: 26px; }
    #${USAGE_SECTION_ID} .dsh-recharge-modes {
      display: inline-flex; gap: 4px; padding: 4px; border-radius: 10px; background: rgba(128,138,152,.1);
    }
    #${USAGE_SECTION_ID} .dsh-recharge-modes button {
      min-height: 30px; padding: 4px 12px; border: 0; background: transparent;
    }
    #${USAGE_SECTION_ID} .dsh-recharge-modes button[aria-selected="true"] { background: rgba(128,138,152,.24); }
    #${USAGE_SECTION_ID} .dsh-recharge-field { margin-top: 16px; }
    #${USAGE_SECTION_ID} .dsh-recharge-label { display: block; margin-bottom: 9px; font-size: 13px; }
    #${USAGE_SECTION_ID} .dsh-amounts { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; }
    #${USAGE_SECTION_ID} .dsh-amounts button { min-width: 58px; background: rgba(128,138,152,.2); }
    #${USAGE_SECTION_ID} .dsh-amounts button[aria-pressed="true"] {
      border-color: #f4f6fa; background: #f4f6fa; color: #16171a;
    }
    #${USAGE_SECTION_ID} .dsh-custom-amount {
      width: 110px; height: 36px; box-sizing: border-box; padding: 6px 10px; border-radius: 9px;
      border: 1px solid rgba(255,255,255,.2); color: var(--dsw-alias-label-primary, #eef4ff);
      background: rgba(128,138,152,.1); font: 13px inherit;
    }
    #${USAGE_SECTION_ID} .dsh-price-link { border-color: transparent; background: transparent; }
    #${USAGE_SECTION_ID} .dsh-price-notice {
      margin-top: 14px; color: #f59e0b; font-size: 12px; line-height: 19px;
    }
    #${USAGE_SECTION_ID} .dsh-payment-methods { display: grid; gap: 10px; }
    #${USAGE_SECTION_ID} .dsh-payment-method {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 9px 12px;
      border-radius: 10px; background: transparent; text-align: left; font-size: 14px;
    }
    #${USAGE_SECTION_ID} .dsh-payment-method[aria-pressed="true"] { border-color: #f4f6fa; box-shadow: inset 0 0 0 1px #f4f6fa; }
    #${USAGE_SECTION_ID} .dsh-pay-logo {
      display: block; flex: none; height: 28px; color: var(--dsw-alias-label-primary, #eef4ff);
    }
    #${USAGE_SECTION_ID} .dsh-pay-logo svg { display: block; width: 100%; height: 100%; overflow: visible; }
    #${USAGE_SECTION_ID} .dsh-pay-logo.alipay,
    #${USAGE_SECTION_ID} .dsh-pay-logo.wechat { width: 28px; }
    #${USAGE_SECTION_ID} .dsh-pay-button {
      width: 100%; margin-top: 24px; min-height: 42px; border: 0; background: #f4f6fa; color: #17181b; font-size: 14px;
    }
    #${USAGE_SECTION_ID} .dsh-payment-login { width: 100%; margin-top: 10px; }
    #${USAGE_SECTION_ID} .dsh-recharge-account { margin-top: 22px; text-align: center; font-size: 13px; }
    #${USAGE_SECTION_ID} .dsh-payment-status { min-height: 18px; margin-top: 10px; color: #93b4ff; font-size: 12px; text-align: center; }
    #${USAGE_SECTION_ID} .dsh-recharge-tips { margin-top: 54px; color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 12px; line-height: 20px; }
    #${USAGE_SECTION_ID} .dsh-corporate-card {
      margin-top: 18px; padding: 18px; border: 1px solid rgba(128,138,152,.24); border-radius: 13px;
      background: rgba(128,138,152,.08);
    }
    #${USAGE_SECTION_ID} .dsh-usage-grid {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
    }
    #${USAGE_SECTION_ID} .dsh-usage-card {
      padding: 10px; border: 1px solid var(--dsw-alias-stroke-secondary, rgba(128,138,152,.24));
      border-radius: 11px; background: var(--dsw-alias-bg-layer-1, rgba(128,138,152,.08));
    }
    #${USAGE_SECTION_ID} .dsh-usage-period {
      color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 12px; line-height: 14px;
    }
    #${USAGE_SECTION_ID} .dsh-usage-total {
      margin: 2px 0 7px; font-size: 18px; line-height: 23px; font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    #${USAGE_SECTION_ID} .dsh-usage-total small { font-size: 11px; font-weight: 500; }
    #${USAGE_SECTION_ID} .dsh-usage-metrics {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px;
    }
    #${USAGE_SECTION_ID} .dsh-usage-metric {
      display: block; min-width: 0; color: var(--dsw-alias-label-secondary, #a7abb4);
      font-size: 11px; line-height: 12px;
    }
    #${USAGE_SECTION_ID} .dsh-usage-metric strong {
      display: block; overflow: hidden; margin-top: 1px; color: var(--dsw-alias-label-primary, #e7e9ed);
      font-size: 12px; line-height: 14px; font-weight: 500; font-variant-numeric: tabular-nums;
      text-overflow: ellipsis; white-space: nowrap;
    }
    #${USAGE_SECTION_ID} .dsh-balance-card {
      position: relative; overflow: hidden; margin-bottom: 8px; padding: 8px 12px;
      border-color: rgba(78,125,255,.34);
      background: linear-gradient(135deg, rgba(78,125,255,.13), rgba(128,138,152,.07) 58%);
    }
    #${USAGE_SECTION_ID} .dsh-balance-card::before {
      content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: #4e7dff;
    }
    #${USAGE_SECTION_ID} .dsh-usage-series {
      container: dsh-usage-series / inline-size; margin-top: 8px;
    }
    #${USAGE_SECTION_ID} .dsh-series-columns {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
    }
    #${USAGE_SECTION_ID} .dsh-series-panel {
      display: flex; min-width: 0; padding: 9px; flex-direction: column;
      border: 1px solid var(--dsw-alias-stroke-secondary, rgba(128,138,152,.18));
      border-radius: 9px; background: rgba(128,138,152,.055);
    }
    #${USAGE_SECTION_ID} .dsh-series-panel-head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      min-height: 32px; margin-bottom: 6px;
    }
    #${USAGE_SECTION_ID} .dsh-series-panel-title h3 {
      margin: 0; font-size: 13px; line-height: 17px; font-weight: 500;
    }
    #${USAGE_SECTION_ID} .dsh-series-panel-title span {
      display: block; margin-top: 1px; color: var(--dsw-alias-label-secondary, #a7abb4);
      font-size: 11px; line-height: 13px;
    }
    #${USAGE_SECTION_ID} .dsh-series-total {
      min-width: 60px; text-align: right; font-variant-numeric: tabular-nums;
    }
    #${USAGE_SECTION_ID} .dsh-series-total strong {
      display: block; font-size: 13px; line-height: 17px; font-weight: 600;
    }
    #${USAGE_SECTION_ID} .dsh-series-total span {
      display: block; color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 10px; line-height: 12px;
    }
    #${USAGE_SECTION_ID} .dsh-series-table-head {
      display: grid; grid-template-columns: 44px minmax(66px, 1fr) 56px; gap: 6px;
      padding: 0 3px 3px; color: var(--dsw-alias-label-secondary, #a7abb4);
      font-size: 10px; line-height: 12px;
    }
    #${USAGE_SECTION_ID} .dsh-series-table-head span:nth-child(n+2) { text-align: right; }
    #${USAGE_SECTION_ID} .dsh-series-list { display: grid; gap: 2px; }
    #${USAGE_SECTION_ID} .dsh-series-row {
      display: grid; grid-template-columns: 44px minmax(66px, 1fr) 56px; gap: 6px; align-items: center;
      min-height: 22px; padding: 1px 3px; border-radius: 6px; box-sizing: border-box;
      color: var(--dsw-alias-label-primary, #e7e9ed); font-size: 11px; line-height: 14px;
      font-variant-numeric: tabular-nums;
    }
    #${USAGE_SECTION_ID} .dsh-series-row:hover { background: rgba(128,138,152,.08); }
    #${USAGE_SECTION_ID} .dsh-series-row[data-empty="true"] { color: var(--dsw-alias-label-secondary, #8d929b); }
    #${USAGE_SECTION_ID} .dsh-series-meter {
      position: relative; height: 16px; overflow: hidden; border-radius: 5px;
      background: rgba(128,138,152,.08); text-align: right;
    }
    #${USAGE_SECTION_ID} .dsh-series-meter-fill {
      position: absolute; inset: 0 auto 0 0; width: var(--dsh-series-level, 0%);
      border-radius: inherit; background: linear-gradient(90deg, rgba(79,140,255,.12), rgba(79,140,255,.32));
    }
    #${USAGE_SECTION_ID} .dsh-series-meter-value {
      position: relative; z-index: 1; display: block; padding: 1px 4px;
      color: var(--dsw-alias-label-secondary, #a7abb4);
    }
    #${USAGE_SECTION_ID} .dsh-series-cost { text-align: right; }
    #${USAGE_SECTION_ID} .dsh-price-band-list {
      display: grid; min-height: 0; flex: 1; grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 6px;
    }
    #${USAGE_SECTION_ID} .dsh-price-band {
      --dsh-band-color: #60a5fa; --dsh-band-bg: rgba(96,165,250,.08);
      min-width: 0; padding: 8px; border: 1px solid rgba(128,138,152,.14);
      border-left: 3px solid var(--dsh-band-color); border-radius: 8px;
      background: linear-gradient(115deg, var(--dsh-band-bg), rgba(128,138,152,.025));
      font-variant-numeric: tabular-nums;
    }
    #${USAGE_SECTION_ID} .dsh-price-band[data-band="peak"] {
      --dsh-band-color: #f59e0b; --dsh-band-bg: rgba(245,158,11,.09);
    }
    #${USAGE_SECTION_ID} .dsh-price-band-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    #${USAGE_SECTION_ID} .dsh-price-band-name {
      display: flex; min-width: 0; align-items: center; gap: 6px;
      font-size: 12px; line-height: 15px; font-weight: 500;
    }
    #${USAGE_SECTION_ID} .dsh-price-band-name::before {
      content: ''; width: 7px; height: 7px; flex: none; border-radius: 999px;
      background: var(--dsh-band-color); box-shadow: 0 0 0 3px var(--dsh-band-bg);
    }
    #${USAGE_SECTION_ID} .dsh-price-band-cost { font-size: 12px; line-height: 15px; font-weight: 600; }
    #${USAGE_SECTION_ID} .dsh-price-band-schedule {
      min-height: 12px; margin: 1px 0 6px; color: var(--dsw-alias-label-secondary, #a7abb4);
      font-size: 10px; line-height: 12px;
    }
    #${USAGE_SECTION_ID} .dsh-price-band-meter {
      height: 4px; overflow: hidden; border-radius: 999px; background: rgba(128,138,152,.12);
    }
    #${USAGE_SECTION_ID} .dsh-price-band-meter span {
      display: block; width: var(--dsh-band-level, 0%); height: 100%; border-radius: inherit;
      background: var(--dsh-band-color); opacity: .72;
    }
    #${USAGE_SECTION_ID} .dsh-price-band-stats {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin-top: 5px; color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 10px; line-height: 12px;
    }
    #${USAGE_SECTION_ID} .dsh-price-band-stats strong {
      color: var(--dsw-alias-label-primary, #e7e9ed); font-size: 11px; font-weight: 500;
    }
    #${USAGE_SECTION_ID} .dsh-series-empty {
      display: grid; min-height: 124px; place-content: center; gap: 6px; text-align: center;
      border: 1px dashed rgba(128,138,152,.18); border-radius: 9px;
      color: var(--dsw-alias-label-secondary, #8d929b); font-size: 11px; line-height: 17px;
    }
    #${USAGE_SECTION_ID} .dsh-series-empty::before {
      content: ''; width: 22px; height: 14px; margin: auto;
      border-bottom: 2px solid rgba(128,138,152,.34);
      background: linear-gradient(135deg, transparent 42%, rgba(128,138,152,.28) 43% 51%, transparent 52%);
    }
    #${USAGE_SECTION_ID} .dsh-series-panel > [data-field="series-price-bands"] {
      display: flex; min-height: 0; flex: 1; flex-direction: column;
    }
    #${USAGE_SECTION_ID} .dsh-series-panel > [data-field="series-price-bands"] .dsh-series-empty { flex: 1; }
    #${USAGE_SECTION_ID} .dsh-series-note {
      margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(128,138,152,.14);
      color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 10px; line-height: 12px;
    }
    #${USAGE_SECTION_ID} .dsh-balance-title {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      margin-bottom: 8px; font-size: 12px; font-weight: 500;
    }
    #${USAGE_SECTION_ID} .dsh-balance-card .dsh-balance-title > span:first-child {
      font-size: 13px; font-weight: 650;
    }
    #${USAGE_SECTION_ID} .dsh-balance-card .dsh-balance-title { margin-bottom: 4px; }
    #${USAGE_SECTION_ID} .dsh-balance-state {
      padding: 2px 6px; border-radius: 999px; color: var(--dsw-alias-label-secondary, #a7abb4);
      background: rgba(128,138,152,.14); font-size: 11px; font-weight: 400;
    }
    #${USAGE_SECTION_ID} .dsh-balance-state[data-tone="success"] { color: #4ade80; }
    #${USAGE_SECTION_ID} .dsh-balance-state[data-tone="error"] { color: #f87171; }
    #${USAGE_SECTION_ID} .dsh-balance-list { display: grid; gap: 10px; }
    #${USAGE_SECTION_ID} .dsh-balance-row {
      display: grid; grid-template-columns: minmax(54px, .8fr) repeat(3, minmax(58px, 1fr));
      gap: 8px; align-items: end; padding-top: 6px;
      border-top: 1px solid var(--dsw-alias-stroke-secondary, rgba(128,138,152,.18));
    }
    #${USAGE_SECTION_ID} .dsh-balance-row:first-child { padding-top: 0; border-top: 0; }
    #${USAGE_SECTION_ID} .dsh-balance-cell { color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 11px; }
    #${USAGE_SECTION_ID} .dsh-balance-cell strong {
      display: block; margin-top: 1px; color: var(--dsw-alias-label-primary, #e7e9ed);
      font-size: 15px; line-height: 17px; font-weight: 600; font-variant-numeric: tabular-nums;
    }
    #${USAGE_SECTION_ID} .dsh-balance-cell[data-balance-field="remaining"] {
      color: #93b4ff;
    }
    #${USAGE_SECTION_ID} .dsh-balance-cell[data-balance-field="remaining"] strong {
      color: #c7d7ff;
    }
    #${USAGE_SECTION_ID} .dsh-usage-footnote {
      margin-top: 3px; color: var(--dsw-alias-label-secondary, #a7abb4); font-size: 10px; line-height: 12px;
    }
    @container dsh-usage-page (max-width: 390px) {
      #${USAGE_SECTION_ID} .dsh-balance-row { grid-template-columns: 1fr 1fr; }
    }
    @container dsh-usage-series (max-width: 430px) {
      #${USAGE_SECTION_ID} .dsh-series-columns { grid-template-columns: 1fr; }
      #${USAGE_SECTION_ID} .dsh-series-empty { min-height: 94px; }
    }
    @container dsh-usage-series (max-width: 340px) {
      #${USAGE_SECTION_ID} .dsh-balance-title { align-items: flex-start; flex-direction: column; gap: 7px; }
    }
    #${LOW_BALANCE_TOAST_ID} {
      position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;
      width: min(360px, calc(100vw - 48px)); box-sizing: border-box; padding: 16px;
      border: 1px solid rgba(249,115,22,.42); border-radius: 14px;
      color: var(--dsw-alias-label-primary, #eef4ff);
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #292a2e) 94%, #f97316 6%);
      box-shadow: 0 18px 50px rgba(0,0,0,.36); font-family: inherit;
    }
    #${LOW_BALANCE_TOAST_ID} strong { display: block; margin-bottom: 5px; font-size: 14px; }
    #${LOW_BALANCE_TOAST_ID} p {
      margin: 0; color: var(--dsw-alias-label-secondary, #b9bdc6); font-size: 12px; line-height: 19px;
    }
    #${LOW_BALANCE_TOAST_ID} .dsh-toast-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    #${LOW_BALANCE_TOAST_ID} button, #${RECHARGE_DIALOG_ID} button {
      min-height: 34px; padding: 6px 12px; border-radius: 9px;
      border: 1px solid var(--dsw-alias-stroke-secondary, rgba(255,255,255,.16));
      color: var(--dsw-alias-label-primary, #eef4ff); background: var(--dsw-alias-bg-layer-1, #3a3b3f);
      cursor: pointer; font: 12px/20px inherit;
    }
    #${LOW_BALANCE_TOAST_ID} button.primary, #${RECHARGE_DIALOG_ID} button.primary {
      border-color: #2563eb; background: #2563eb; color: white;
    }
    #${RECHARGE_DIALOG_ID} {
      position: fixed; inset: 0; z-index: 2147483100; display: grid; place-items: center;
      padding: 24px; box-sizing: border-box; background: rgba(0,0,0,.58); font-family: inherit;
    }
    #${RECHARGE_DIALOG_ID} .dsh-recharge-panel {
      width: min(460px, 100%); box-sizing: border-box; padding: 22px;
      border: 1px solid var(--dsw-alias-stroke-secondary, rgba(255,255,255,.16)); border-radius: 18px;
      color: var(--dsw-alias-label-primary, #eef4ff); background: var(--dsw-alias-bg-layer-0, #292a2e);
      box-shadow: 0 24px 80px rgba(0,0,0,.48);
    }
    #${RECHARGE_DIALOG_ID} h2 { margin: 0 0 8px; font-size: 19px; }
    #${RECHARGE_DIALOG_ID} p {
      margin: 0; color: var(--dsw-alias-label-secondary, #aeb2bc); font-size: 13px; line-height: 20px;
    }
    #${RECHARGE_DIALOG_ID} .dsh-recharge-balance {
      display: flex; align-items: end; justify-content: space-between; gap: 20px;
      margin: 18px 0; padding: 16px; border-radius: 13px; background: rgba(128,138,152,.11);
    }
    #${RECHARGE_DIALOG_ID} .dsh-recharge-balance span { color: var(--dsw-alias-label-secondary, #aeb2bc); font-size: 12px; }
    #${RECHARGE_DIALOG_ID} .dsh-recharge-balance strong { font-size: 24px; font-variant-numeric: tabular-nums; }
    #${RECHARGE_DIALOG_ID} .dsh-recharge-note {
      padding: 11px 12px; border-radius: 10px; background: rgba(37,99,235,.11); color: #93b4ff; font-size: 12px;
    }
    #${RECHARGE_DIALOG_ID} .dsh-recharge-status { min-height: 18px; margin-top: 10px; color: #f87171; font-size: 12px; }
    #${RECHARGE_DIALOG_ID} .dsh-recharge-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 14px; }
    #${RECHARGE_DIALOG_ID} .dsh-payment-qr {
      display: grid; justify-items: center; gap: 12px; margin-top: 18px;
    }
    #${RECHARGE_DIALOG_ID} .dsh-payment-qr img {
      width: 260px; height: 260px; box-sizing: border-box; padding: 10px;
      border-radius: 14px; background: #fff; image-rendering: pixelated;
    }
    #${RECHARGE_DIALOG_ID} .dsh-payment-amount {
      font-size: 25px; line-height: 34px; font-weight: 650; font-variant-numeric: tabular-nums;
    }
    #${RECHARGE_DIALOG_ID} .dsh-payment-order {
      max-width: 100%; overflow: hidden; color: var(--dsw-alias-label-secondary, #aeb2bc);
      font: 11px/17px ui-monospace, SFMono-Regular, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap;
    }
    #${RECHARGE_DIALOG_ID} .dsh-qr-status {
      min-height: 20px; margin-top: 4px; color: #93b4ff; font-size: 12px; line-height: 19px; text-align: center;
    }
    #${RECHARGE_DIALOG_ID} .dsh-qr-status[data-tone="success"] { color: #4ade80; }
    #${RECHARGE_DIALOG_ID} .dsh-qr-status[data-tone="error"] { color: #f87171; }
  `
  document.head.appendChild(style)
}

function formatPriceBandDuration(milliseconds) {
  const totalMinutes = Math.max(1, Math.ceil(Math.max(0, Number(milliseconds) || 0) / 60000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分`
}

function formatBeijingTransition(time, now = Date.now()) {
  const shifted = new Date(time + 8 * 3600 * 1000)
  const current = new Date(now + 8 * 3600 * 1000)
  const sameDay = shifted.getUTCFullYear() === current.getUTCFullYear()
    && shifted.getUTCMonth() === current.getUTCMonth()
    && shifted.getUTCDate() === current.getUTCDate()
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    ...(sameDay ? {} : { weekday: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(time))
}

function ensurePriceBandBanner() {
  let banner = document.getElementById(PRICE_BAND_BANNER_ID)
  if (banner) return banner
  banner = document.createElement('div')
  banner.id = PRICE_BAND_BANNER_ID
  banner.setAttribute('role', 'status')
  banner.setAttribute('aria-live', 'polite')
  banner.innerHTML = `
    <span class="dsh-price-band-dot" aria-hidden="true"></span>
    <strong data-field="label"></strong>
    <span data-field="detail"></span>
    <span data-field="countdown"></span>
  `
  document.body.appendChild(banner)
  return banner
}

function visibleElement(element) {
  if (!element || element.hidden || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
    && rect.right > 0 && rect.bottom > 0
    && rect.left < window.innerWidth && rect.top < window.innerHeight
}

function conversationSurfaceVisible() {
  if ([...document.querySelectorAll('[role="dialog"]')].some(visibleElement)) return false
  const editors = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')
  return [...editors].some(visibleElement)
}

function findConversationModeAnchor() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node.nodeValue?.trim() === '标准模式') {
      const label = node.parentElement
      const anchor = label?.closest('button, [role="button"], [role="group"]') || label
      if (anchor && !anchor.contains(document.getElementById(PRICE_BAND_BANNER_ID)) && visibleElement(anchor)) return anchor
    }
    node = walker.nextNode()
  }
  return null
}

function mountPriceBandBanner(banner) {
  const anchor = findConversationModeAnchor()
  if (!anchor?.parentElement) return false
  if (banner.parentElement !== anchor.parentElement || banner.previousElementSibling !== anchor) {
    anchor.insertAdjacentElement('afterend', banner)
  }
  return true
}

async function syncPriceBandBanner() {
  const banner = ensurePriceBandBanner()
  banner.hidden = !conversationSurfaceVisible() || !mountPriceBandBanner(banner)
  if (banner.hidden || priceBandRequestPending) return
  priceBandRequestPending = true
  try {
    const result = await ipcRenderer.invoke('dsh-usage:price-band')
    if (!result.ok) throw new Error(result.error || '无法读取计价时段')
    if (!conversationSurfaceVisible() || !mountPriceBandBanner(banner)) {
      banner.hidden = true
      return
    }
    const status = result.value
    const now = Date.now()
    const label = banner.querySelector('[data-field="label"]')
    const detail = banner.querySelector('[data-field="detail"]')
    const countdown = banner.querySelector('[data-field="countdown"]')
    banner.dataset.band = status.band
    label.textContent = status.label
    detail.textContent = status.band === 'peak'
      ? '高峰价'
      : '约 5 折'
    const destination = status.nextBand === 'peak' ? '高峰' : '空闲'
    countdown.textContent = status.nextAt === null
      ? status.schedule
      : `距${destination} ${formatPriceBandDuration(status.remainingMs)}`
    const nextText = status.nextAt === null ? '' : `；下次切换 ${formatBeijingTransition(status.nextAt, now)}`
    banner.title = `${status.schedule}${nextText}`
    banner.setAttribute('aria-label', `${status.label}。${detail.textContent}。${countdown.textContent}`)
    banner.hidden = false
  } catch (_) {
    banner.hidden = true
  } finally {
    priceBandRequestPending = false
  }
}

function queuePriceBandBannerSync() {
  if (priceBandSyncTimer !== null) return
  priceBandSyncTimer = setTimeout(() => {
    priceBandSyncTimer = null
    void syncPriceBandBanner()
  }, 60)
}

function updateSectionDisplay(section) {
  if (!section || !section.isConnected) return
  const desktop = section.querySelector('[data-field="desktop-version"]')
  const current = section.querySelector('[data-field="current-version"]')
  const desktopCardVersion = section.querySelector('[data-field="desktop-card-version"]')
  const desktopStatus = section.querySelector('[data-field="desktop-status"]')
  const kernelStatus = section.querySelector('[data-field="kernel-status"]')
  if (desktop) {
    desktop.textContent = cachedVersions.desktopVersion
      ? `应用 ${cachedVersions.desktopVersion}`
      : '应用'
  }
  if (desktopCardVersion) desktopCardVersion.textContent = cachedVersions.desktopVersion || '正在读取…'
  if (current) current.textContent = cachedVersions.currentVersion || '正在读取…'
  if (desktopStatus) {
    desktopStatus.textContent = cachedStatus.desktop.text
    desktopStatus.dataset.tone = cachedStatus.desktop.tone
    desktopStatus.title = cachedStatus.desktop.text
  }
  if (kernelStatus) {
    kernelStatus.textContent = cachedStatus.kernel.text
    kernelStatus.dataset.tone = cachedStatus.kernel.tone
    kernelStatus.title = cachedStatus.kernel.text
  }
  syncUpdateButtons(section)
}

function syncUpdateButtons(section) {
  if (!section || !section.isConnected) return
  for (const button of section.querySelectorAll('button[data-action]')) {
    const action = button.dataset.action || ''
    const target = action.startsWith('desktop-') ? 'desktop' : 'kernel'
    const busy = section.dataset[`${target}Busy`] === 'true'
    button.disabled = busy || (target === 'desktop' && !cachedVersions.desktopUpdateSupported)
  }
}

function setSectionBusy(section, target, busy) {
  section.dataset[`${target}Busy`] = busy ? 'true' : 'false'
  syncUpdateButtons(section)
}

function setStatus(section, target, text, tone = 'muted') {
  cachedStatus[target] = { text, tone }
  updateSectionDisplay(section)
}

function refreshMountedUpdateSections() {
  for (const section of document.querySelectorAll(`#${UPDATE_SECTION_ID}`)) {
    updateSectionDisplay(section)
  }
}

ipcRenderer.on('dsh-desktop-update:progress', (_event, progress) => {
  const rawPercent = Number(progress?.percent)
  const percent = Number.isFinite(rawPercent) ? Math.min(100, Math.max(0, rawPercent)) : 0
  cachedStatus.desktop = {
    text: `正在下载 Desktop 更新：${percent.toFixed(1)}%`,
    tone: 'muted',
  }
  refreshMountedUpdateSections()
})

ipcRenderer.on('dsh-desktop-update:available', (_event, info) => {
  if (info?.currentVersion) cachedVersions.desktopVersion = info.currentVersion
  cachedStatus.desktop = {
    text: `发现 Desktop ${info?.latestVersion || '新版本'}，可立即下载并安装`,
    tone: 'success',
  }
  refreshMountedUpdateSections()
})

async function loadUpdateState(section) {
  try {
    const result = await ipcRenderer.invoke('dsh-update:state')
    if (!result.ok) throw new Error(result.error)
    cachedVersions = { ...cachedVersions, ...result.value }
    cachedVersions.desktopUpdateSupported = result.value.desktopUpdate?.supported !== false
    if (!cachedVersions.desktopUpdateSupported) {
      cachedStatus.desktop = { text: '开发模式不支持 Desktop 自动更新', tone: 'muted' }
    }
    updateSectionDisplay(section)
  } catch (error) {
    setStatus(section, 'kernel', `无法读取版本信息：${error && error.message ? error.message : String(error)}`, 'error')
  }
}

function createUpdateSection() {
  const section = document.createElement('section')
  section.id = UPDATE_SECTION_ID
  section.hidden = true
  section.innerHTML = `
    <div class="dsh-update-heading">
      <div>
        <h2>软件更新</h2>
        <p>Desktop 外壳和 Harness 内核分别更新；安装完成后应用会自动重启。</p>
      </div>
      <span class="dsh-update-desktop-version" data-field="desktop-version">应用</span>
    </div>
    <div class="dsh-update-card">
      <div class="dsh-update-row">
        <span class="dsh-update-label">应用版本</span>
        <span class="dsh-update-version" data-field="desktop-card-version">正在读取…</span>
      </div>
      <div class="dsh-update-status" data-field="desktop-status" data-tone="muted" role="status" aria-live="polite">尚未检查应用更新</div>
      <div class="dsh-update-actions">
        <button type="button" data-action="desktop-check">检查 Desktop</button>
        <button type="button" class="primary" data-action="desktop-install">更新 Desktop</button>
      </div>
    </div>
    <div class="dsh-update-card">
      <div class="dsh-update-row">
        <span class="dsh-update-label">Harness 内核版本</span>
        <span class="dsh-update-version" data-field="current-version">正在读取…</span>
      </div>
      <div class="dsh-update-status" data-field="kernel-status" data-tone="muted" role="status" aria-live="polite">尚未检查内核更新</div>
      <div class="dsh-update-actions">
        <button type="button" data-action="kernel-check">检查内核</button>
        <button type="button" class="primary" data-action="kernel-install">更新内核</button>
      </div>
    </div>
  `

  section.querySelector('[data-action="desktop-check"]').addEventListener('click', async () => {
    setSectionBusy(section, 'desktop', true)
    setStatus(section, 'desktop', '正在检查 Desktop 更新…')
    try {
      const result = await ipcRenderer.invoke('dsh-desktop-update:check')
      if (!result.ok) throw new Error(result.error)
      const info = result.value
      setStatus(section, 'desktop', info.updateAvailable
        ? `发现 Desktop ${info.latestVersion}，当前版本 ${info.currentVersion}`
        : `应用已是最新版本 ${info.currentVersion}`, info.updateAvailable ? 'success' : 'muted')
    } catch (error) {
      setStatus(section, 'desktop', `Desktop 检查失败：${error && error.message ? error.message : String(error)}`, 'error')
    } finally {
      setSectionBusy(section, 'desktop', false)
    }
  })

  section.querySelector('[data-action="desktop-install"]').addEventListener('click', async () => {
    setSectionBusy(section, 'desktop', true)
    setStatus(section, 'desktop', '正在下载 Desktop 更新，请勿关闭应用…')
    try {
      const result = await ipcRenderer.invoke('dsh-desktop-update:install')
      if (!result.ok) throw new Error(result.error)
      const info = result.value
      if (info.readyToInstall) {
        setStatus(section, 'desktop', `Desktop ${info.downloadedVersion} 已下载，正在安装并重启…`, 'success')
      } else {
        setStatus(section, 'desktop', `应用已是最新版本 ${info.currentVersion}`)
        setSectionBusy(section, 'desktop', false)
      }
    } catch (error) {
      setStatus(section, 'desktop', `Desktop 更新失败：${error && error.message ? error.message : String(error)}`, 'error')
      setSectionBusy(section, 'desktop', false)
    }
  })

  section.querySelector('[data-action="kernel-check"]').addEventListener('click', async () => {
    setSectionBusy(section, 'kernel', true)
    setStatus(section, 'kernel', '正在检查内核更新…')
    try {
      const result = await ipcRenderer.invoke('dsh-update:check')
      if (!result.ok) throw new Error(result.error)
      const info = result.value
      cachedVersions.currentVersion = info.currentVersion
      setStatus(section, 'kernel', info.updateAvailable
        ? `发现新版本 ${info.latestVersion}，当前版本 ${info.currentVersion}`
        : `当前已是最新版本 ${info.currentVersion}`, info.updateAvailable ? 'success' : 'muted')
    } catch (error) {
      setStatus(section, 'kernel', `内核检查失败：${error && error.message ? error.message : String(error)}`, 'error')
    } finally {
      setSectionBusy(section, 'kernel', false)
    }
  })

  section.querySelector('[data-action="kernel-install"]').addEventListener('click', async () => {
    setSectionBusy(section, 'kernel', true)
    setStatus(section, 'kernel', '正在下载并安装内核，请勿关闭应用…')
    try {
      const result = await ipcRenderer.invoke('dsh-update:install')
      if (!result.ok) throw new Error(result.error)
      const info = result.value
      cachedVersions.currentVersion = info.currentVersion
      if (info.updated) {
        setStatus(section, 'kernel', `内核已更新到 ${info.currentVersion}，正在重启…`, 'success')
      } else {
        setStatus(section, 'kernel', `内核已是最新版本 ${info.currentVersion}`)
        setSectionBusy(section, 'kernel', false)
      }
    } catch (error) {
      setStatus(section, 'kernel', `内核更新失败：${error && error.message ? error.message : String(error)}`, 'error')
      setSectionBusy(section, 'kernel', false)
    }
  })

  updateSectionDisplay(section)
  void loadUpdateState(section)
  return section
}

const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

function formatTokens(value) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`
  return integerFormatter.format(number)
}

function totalTokens(usage) {
  return (usage?.inputTokens || 0) + (usage?.outputTokens || 0)
    + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0)
}

function cacheHitRate(usage) {
  const input = (usage?.inputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0)
  return input > 0 ? `${Math.round(((usage?.cacheReadTokens || 0) / input) * 100)}%` : '—'
}

function renderUsagePeriod(section, name, usage) {
  const root = section.querySelector(`[data-period="${name}"]`)
  if (!root) return
  root.querySelector('[data-value="total"]').textContent = formatTokens(totalTokens(usage))
  root.querySelector('[data-value="requests"]').textContent = integerFormatter.format(usage?.requests || 0)
  root.querySelector('[data-value="input"]').textContent = formatTokens((usage?.inputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0))
  root.querySelector('[data-value="output"]').textContent = formatTokens(usage?.outputTokens || 0)
  root.querySelector('[data-value="cache"]').textContent = cacheHitRate(usage)
  root.querySelector('[data-value="cost"]').textContent = usage?.costCny != null
    ? `¥${Number(usage.costCny).toFixed(2)}`
    : '—'
}

function formatEstimatedCost(value, { zeroAsDash = false } = {}) {
  const cost = Number(value) || 0
  if (cost <= 0) return zeroAsDash ? '—' : '¥0.00'
  return cost < 0.01 ? '<¥0.01' : `¥${cost.toFixed(2)}`
}

function seriesTotals(entries) {
  return (Array.isArray(entries) ? entries : []).reduce((total, entry) => {
    total.tokens += Number(entry?.tokens) || 0
    total.costCny += Number(entry?.costCny) || 0
    return total
  }, { tokens: 0, costCny: 0 })
}

function renderSeriesTotal(section, field, entries) {
  const root = section.querySelector(`[data-field="${field}"]`)
  if (!root) return
  const total = seriesTotals(entries)
  root.replaceChildren()
  const cost = document.createElement('strong')
  cost.textContent = formatEstimatedCost(total.costCny)
  const tokens = document.createElement('span')
  tokens.textContent = `${formatTokens(total.tokens)} tokens`
  root.append(cost, tokens)
}

function renderDailySeries(section, entries) {
  const root = section.querySelector('[data-field="series-days"]')
  if (!root) return
  root.replaceChildren()
  renderSeriesTotal(section, 'series-days-total', entries)
  if (!Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'dsh-series-empty'
    empty.textContent = '暂无每日用量'
    root.appendChild(empty)
    return
  }
  const maxTokens = Math.max(...entries.map(entry => Number(entry?.tokens) || 0), 0)
  for (const entry of entries) {
    const tokensValue = Number(entry?.tokens) || 0
    const row = document.createElement('div')
    row.className = 'dsh-series-row'
    row.dataset.empty = tokensValue > 0 ? 'false' : 'true'
    row.title = `${entry.date} · ${formatTokens(tokensValue)} tokens · 估算 ${formatEstimatedCost(entry.costCny)}`

    const label = document.createElement('span')
    label.textContent = entry.date
    const meter = document.createElement('div')
    meter.className = 'dsh-series-meter'
    const fill = document.createElement('span')
    fill.className = 'dsh-series-meter-fill'
    fill.style.setProperty('--dsh-series-level', maxTokens > 0 && tokensValue > 0
      ? `${Math.max(3, (tokensValue / maxTokens) * 100)}%`
      : '0%')
    const tokens = document.createElement('span')
    tokens.className = 'dsh-series-meter-value'
    tokens.textContent = tokensValue > 0 ? formatTokens(tokensValue) : '—'
    meter.append(fill, tokens)
    const cost = document.createElement('span')
    cost.className = 'dsh-series-cost'
    cost.textContent = formatEstimatedCost(entry.costCny, { zeroAsDash: tokensValue === 0 })
    row.append(label, meter, cost)
    root.appendChild(row)
  }
}

function renderPriceBands(section, entries) {
  const root = section.querySelector('[data-field="series-price-bands"]')
  if (!root) return
  root.replaceChildren()
  renderSeriesTotal(section, 'series-price-bands-total', entries)
  const values = Array.isArray(entries) ? entries : []
  if (values.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'dsh-series-empty'
    empty.textContent = '暂无计价时段数据'
    root.appendChild(empty)
    return
  }

  const maxTokens = Math.max(...values.map(entry => Number(entry?.tokens) || 0), 0)
  const list = document.createElement('div')
  list.className = 'dsh-price-band-list'
  for (const entry of values) {
    const tokensValue = Number(entry?.tokens) || 0
    const requests = Number(entry?.requests) || 0
    const row = document.createElement('div')
    row.className = 'dsh-price-band'
    row.dataset.band = entry?.band === 'peak' ? 'peak' : 'off'
    row.title = `${entry.label} · ${entry.schedule} · ${formatTokens(tokensValue)} tokens · ${requests} 次请求 · 估算 ${formatEstimatedCost(entry.costCny)}`
    row.setAttribute('aria-label', row.title)

    const head = document.createElement('div')
    head.className = 'dsh-price-band-head'
    const name = document.createElement('span')
    name.className = 'dsh-price-band-name'
    name.textContent = entry.label || (row.dataset.band === 'peak' ? '高峰时段' : '空闲时段')
    const cost = document.createElement('span')
    cost.className = 'dsh-price-band-cost'
    cost.textContent = formatEstimatedCost(entry.costCny, { zeroAsDash: tokensValue === 0 })
    head.append(name, cost)

    const schedule = document.createElement('div')
    schedule.className = 'dsh-price-band-schedule'
    schedule.textContent = entry.schedule || '—'
    const meter = document.createElement('div')
    meter.className = 'dsh-price-band-meter'
    const fill = document.createElement('span')
    fill.style.setProperty('--dsh-band-level', maxTokens > 0 && tokensValue > 0
      ? `${Math.max(3, (tokensValue / maxTokens) * 100)}%`
      : '0%')
    meter.appendChild(fill)
    const stats = document.createElement('div')
    stats.className = 'dsh-price-band-stats'
    const tokens = document.createElement('span')
    tokens.append('用量 ')
    const tokensStrong = document.createElement('strong')
    tokensStrong.textContent = tokensValue > 0 ? formatTokens(tokensValue) : '—'
    tokens.appendChild(tokensStrong)
    const requestCount = document.createElement('span')
    requestCount.append('请求 ')
    const requestsStrong = document.createElement('strong')
    requestsStrong.textContent = integerFormatter.format(requests)
    requestCount.appendChild(requestsStrong)
    stats.append(tokens, requestCount)
    row.append(head, schedule, meter, stats)
    list.appendChild(row)
  }
  root.appendChild(list)
}

function balanceTone(balance) {
  if (balance?.status !== 'ok') return balance?.status === 'error' ? 'error' : 'muted'
  return balance.isAvailable && !balance.lowBalance ? 'success' : 'error'
}

function balanceStateText(balance) {
  if (balance?.status !== 'ok') return balance?.message || '暂不可用'
  if (!balance.isAvailable) return '余额不足'
  return balance.lowBalance ? '余额偏低' : '账户可用'
}

function cnyBalance(balance) {
  return balance?.status === 'ok'
    ? balance.balances?.find(item => String(item.currency).toUpperCase() === 'CNY') || null
    : null
}

function syncLowBalanceIndicator() {
  for (const nav of document.querySelectorAll(`#${USAGE_NAV_ID}`)) {
    nav.dataset.lowBalance = cachedBalance?.lowBalance ? 'true' : 'false'
    nav.title = cachedBalance?.lowBalance ? 'DeepSeek 余额偏低' : ''
  }
  if (cachedBalance?.status === 'ok' && !cachedBalance.lowBalance) {
    document.getElementById(LOW_BALANCE_TOAST_ID)?.remove()
  }
}

function waitForElement(selector, timeoutMs = 2500) {
  const existing = document.querySelector(selector)
  if (existing) return Promise.resolve(existing)
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector)
      if (!element) return
      observer.disconnect()
      clearTimeout(timer)
      resolve(element)
    })
    const timer = setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeoutMs)
    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
}

async function openRechargeWindow() {
  let usageNav = document.querySelector(`#${USAGE_NAV_ID}`)
  if (!usageNav) {
    const settingsButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent.trim() === '设置' && !button.closest('[role="dialog"]'))
    settingsButton?.click()
    usageNav = await waitForElement(`#${USAGE_NAV_ID}`)
  }
  usageNav?.click()
  const rechargeTab = await waitForElement(`#${USAGE_SECTION_ID} [data-action="show-recharge"]`)
  rechargeTab?.click()
}

function showLowBalanceToast(balance) {
  if (!balance?.lowBalance || document.getElementById(LOW_BALANCE_TOAST_ID)) return
  const cny = cnyBalance(balance)
  const toast = document.createElement('aside')
  toast.id = LOW_BALANCE_TOAST_ID
  toast.setAttribute('role', 'status')
  toast.innerHTML = `
    <strong>DeepSeek 余额偏低</strong>
    <p>当前余额${cny ? `为 ¥${cny.totalBalance}` : '不足'}，低于 ¥${balance.thresholdCny || 5} 提醒线，模型调用可能因费用不足而中断。</p>
    <div class="dsh-toast-actions">
      <button type="button" data-action="later">稍后</button>
      <button type="button" class="primary" data-action="recharge">立即充值</button>
    </div>
  `
  toast.querySelector('[data-action="later"]').addEventListener('click', () => toast.remove())
  toast.querySelector('[data-action="recharge"]').addEventListener('click', () => {
    toast.remove()
    void openRechargeWindow(balance)
  })
  document.body.appendChild(toast)
}

async function checkLowBalanceWarning() {
  try {
    const result = await ipcRenderer.invoke('dsh-usage:balance')
    if (!result.ok) return
    cachedBalance = result.value
    syncLowBalanceIndicator()
    showLowBalanceToast(cachedBalance)
  } catch (_) {
    // 余额提醒是附加能力；网络失败不影响主界面。
  }
}

function renderUsageSnapshot(section, snapshot) {
  cachedBalance = snapshot.balance
  syncLowBalanceIndicator()
  updateRechargeBalance(section)
  renderUsagePeriod(section, 'today', snapshot.usage?.today)
  renderUsagePeriod(section, 'month', snapshot.usage?.month)
  renderUsagePeriod(section, 'all', snapshot.usage?.all)
  renderDailySeries(section, snapshot.usage?.byDay)
  renderPriceBands(section, snapshot.usage?.byPriceBand)

  const state = section.querySelector('[data-field="balance-state"]')
  state.textContent = balanceStateText(snapshot.balance)
  state.dataset.tone = balanceTone(snapshot.balance)
  state.title = state.textContent

  const balanceList = section.querySelector('[data-field="balance-list"]')
  balanceList.replaceChildren()
  if (snapshot.balance?.status === 'ok' && snapshot.balance.balances?.length > 0) {
    for (const balance of snapshot.balance.balances) {
      const row = document.createElement('div')
      row.className = 'dsh-balance-row'
      const values = [
        ['currency', '币种', balance.currency || '—'],
        ['remaining', '剩余余额', balance.totalBalance || '—'],
        ['topped-up', '充值余额', balance.toppedUpBalance || '—'],
        ['granted', '赠送余额', balance.grantedBalance || '—'],
      ]
      for (const [key, label, value] of values) {
        const cell = document.createElement('div')
        cell.className = 'dsh-balance-cell'
        cell.dataset.balanceField = key
        cell.append(label)
        const strong = document.createElement('strong')
        strong.textContent = value
        cell.appendChild(strong)
        row.appendChild(cell)
      }
      balanceList.appendChild(row)
    }
  } else {
    const message = document.createElement('p')
    message.textContent = snapshot.balance?.message || 'DeepSeek 暂未返回余额信息。'
    balanceList.appendChild(message)
  }

  const footnote = section.querySelector('[data-field="footnote"]')
  const generated = new Date(snapshot.usage?.collectedAt || snapshot.generatedAt)
  const unreadable = snapshot.usage?.unreadableFiles || 0
  footnote.textContent = `本地统计来自 ${snapshot.usage?.sessionFiles || 0} 个会话文件，更新时间 ${generated.toLocaleTimeString('zh-CN')}`
    + (unreadable > 0 ? `；${unreadable} 个文件暂时无法读取` : '')
    + (snapshot.usage?.stale ? `；${snapshot.usage.warning || '当前显示上次统计结果'}` : '')
}

async function loadUsageState(section, { announce = false } = {}) {
  const refresh = section.querySelector('[data-action="refresh"]')
  const state = section.querySelector('[data-field="balance-state"]')
  const resultField = section.querySelector('[data-field="refresh-result"]')
  refresh.disabled = true
  refresh.textContent = '刷新中…'
  state.textContent = '正在刷新…'
  state.dataset.tone = 'muted'
  if (announce && resultField) {
    resultField.textContent = '正在刷新…'
    resultField.dataset.tone = 'muted'
  }
  const slowTimer = setTimeout(() => {
    state.textContent = '仍在后台刷新…'
    if (resultField) {
      resultField.textContent = '数据仍在刷新；界面可继续使用'
      resultField.dataset.tone = 'muted'
    }
  }, 2500)
  try {
    const result = await ipcRenderer.invoke('dsh-usage:state')
    if (!result.ok) throw new Error(result.error)
    renderUsageSnapshot(section, result.value)
    if (announce && resultField) {
      const balance = cnyBalance(result.value.balance)
      const balanceText = balance ? `当前余额 ¥${balance.totalBalance} · ` : ''
      resultField.textContent = `刷新成功 · ${balanceText}${new Date().toLocaleTimeString('zh-CN')}`
      resultField.dataset.tone = 'success'
    }
    return result.value
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    state.textContent = `读取失败：${message}`
    state.dataset.tone = 'error'
    if (announce && resultField) {
      resultField.textContent = `刷新失败：${message}`
      resultField.dataset.tone = 'error'
    }
    return null
  } finally {
    clearTimeout(slowTimer)
    refresh.disabled = false
    refresh.textContent = '刷新'
    section.dataset.usageLoaded = 'true'
  }
}

function usagePeriodCard(id, label) {
  return `
    <div class="dsh-usage-card" data-period="${id}">
      <div class="dsh-usage-period">${label}</div>
      <div class="dsh-usage-total"><span data-value="total">—</span> <small>Token</small></div>
      <div class="dsh-usage-metrics">
        <div class="dsh-usage-metric"><span>请求</span><strong data-value="requests">—</strong></div>
        <div class="dsh-usage-metric"><span>输入</span><strong data-value="input">—</strong></div>
        <div class="dsh-usage-metric"><span>输出</span><strong data-value="output">—</strong></div>
        <div class="dsh-usage-metric"><span>缓存</span><strong data-value="cache">—</strong></div>
        <div class="dsh-usage-metric"><span>费用</span><strong data-value="cost">—</strong></div>
      </div>
    </div>`
}

function selectUsagePane(section, paneName) {
  for (const button of section.querySelectorAll('.dsh-usage-tabs button')) {
    button.setAttribute('aria-selected', button.dataset.paneTarget === paneName ? 'true' : 'false')
  }
  for (const pane of section.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== paneName
}

function selectRechargeMode(section, modeName) {
  for (const button of section.querySelectorAll('[data-recharge-mode]')) {
    button.setAttribute('aria-selected', button.dataset.rechargeMode === modeName ? 'true' : 'false')
  }
  for (const pane of section.querySelectorAll('[data-recharge-pane]')) pane.hidden = pane.dataset.rechargePane !== modeName
}

function updateRechargeBalance(section) {
  const balance = cnyBalance(cachedBalance)
  const field = section.querySelector('[data-field="recharge-balance"]')
  if (field) field.textContent = balance ? `¥${balance.totalBalance}` : '暂未获取'
}

async function openOfficialPage(target, statusField) {
  statusField.textContent = target === 'topUp' ? '正在打开 DeepSeek 官方支付页面…' : '正在打开 DeepSeek 官方价格页面…'
  const result = await ipcRenderer.invoke('dsh-usage:open-official', target)
  statusField.textContent = result.ok
    ? '已在默认浏览器打开官方页面。支付确认和验证码均由 DeepSeek 处理。'
    : `无法打开官方页面：${result.error || '未知错误'}`
}

function closePaymentQrDialog() {
  if (paymentPollTimer) clearInterval(paymentPollTimer)
  paymentPollTimer = null
  document.getElementById(RECHARGE_DIALOG_ID)?.remove()
}

function showPaymentQrDialog(section, order) {
  closePaymentQrDialog()
  if (typeof order?.qrDataUrl !== 'string' || !order.qrDataUrl.startsWith('data:image/')) {
    throw new Error('付款二维码数据无效')
  }
  const methodLabel = order.method === 'wechat' ? '微信支付' : '支付宝'
  const dialog = document.createElement('div')
  dialog.id = RECHARGE_DIALOG_ID
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', `${methodLabel}付款二维码`)
  dialog.innerHTML = `
    <div class="dsh-recharge-panel">
      <h2 data-field="qr-title"></h2>
      <p>请核对金额后，使用对应手机应用扫描下方官方动态二维码。</p>
      <div class="dsh-payment-qr">
        <img data-field="qr-image" alt="付款二维码">
        <div class="dsh-payment-amount" data-field="qr-amount"></div>
        <div class="dsh-payment-order" data-field="qr-order"></div>
        <div class="dsh-qr-status" data-field="qr-status">等待扫码付款…</div>
      </div>
      <div class="dsh-recharge-actions">
        <button type="button" data-action="close-qr">关闭</button>
      </div>
    </div>`
  dialog.querySelector('[data-field="qr-title"]').textContent = `${methodLabel}付款二维码`
  dialog.querySelector('[data-field="qr-image"]').src = order.qrDataUrl
  dialog.querySelector('[data-field="qr-amount"]').textContent = `¥${order.amount}`
  dialog.querySelector('[data-field="qr-order"]').textContent = `订单号 ${order.orderId}`
  dialog.querySelector('[data-action="close-qr"]').addEventListener('click', closePaymentQrDialog)
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closePaymentQrDialog()
  })
  document.body.appendChild(dialog)
  dialog.querySelector('[data-action="close-qr"]').focus()

  const statusField = dialog.querySelector('[data-field="qr-status"]')
  let polling = false
  const poll = async () => {
    if (polling || !dialog.isConnected) return
    polling = true
    try {
      const result = await ipcRenderer.invoke('dsh-payment:status', order.orderId)
      if (!dialog.isConnected) return
      if (!result.ok) {
        statusField.textContent = `状态查询失败：${result.error || '未知错误'}`
        statusField.dataset.tone = 'error'
        if (result.code === 'AUTH_REQUIRED') {
          clearInterval(paymentPollTimer)
          paymentPollTimer = null
        }
        return
      }
      const status = result.value
      if (status === 'SUCCESS') {
        statusField.textContent = '支付成功，正在刷新余额…'
        statusField.dataset.tone = 'success'
        clearInterval(paymentPollTimer)
        paymentPollTimer = null
        await new Promise(resolve => setTimeout(resolve, 800))
        const snapshot = await loadUsageState(section)
        if (!dialog.isConnected) return
        const balance = snapshot && cnyBalance(snapshot.balance)
        statusField.textContent = balance
          ? `余额已刷新，当前余额 ¥${balance.totalBalance}`
          : '支付成功；余额暂未刷新，请稍后手动刷新。'
        statusField.dataset.tone = balance ? 'success' : 'error'
      } else if (['FAILED', 'REFUNDED', 'CHARGEBACK'].includes(status)) {
        statusField.textContent = status === 'FAILED' ? '订单支付失败，请关闭后重新生成。' : `订单状态：${status}`
        statusField.dataset.tone = 'error'
        clearInterval(paymentPollTimer)
        paymentPollTimer = null
      } else {
        statusField.textContent = '等待扫码付款…'
        statusField.dataset.tone = 'muted'
      }
    } finally {
      polling = false
    }
  }
  paymentPollTimer = setInterval(() => void poll(), 4000)
  setTimeout(() => void poll(), 1800)
}

function createUsageSection() {
  const section = document.createElement('section')
  section.id = USAGE_SECTION_ID
  section.hidden = true
  section.innerHTML = `
    <div class="dsh-usage-heading">
      <div>
        <h2>使用情况</h2>
        <p>本机模型用量与 DeepSeek 账户余额。</p>
      </div>
      <div class="dsh-usage-actions">
        <span class="dsh-refresh-result" data-field="refresh-result" aria-live="polite"></span>
        <button type="button" data-action="refresh">刷新</button>
      </div>
    </div>
    <div class="dsh-usage-tabs" role="tablist" aria-label="使用情况页面">
      <button type="button" role="tab" aria-selected="true" data-pane-target="usage">用量与余额</button>
      <button type="button" role="tab" aria-selected="false" data-pane-target="recharge" data-action="show-recharge">充值</button>
    </div>
    <div data-pane="usage">
      <div class="dsh-usage-card dsh-balance-card">
        <div class="dsh-balance-title">
          <span>DeepSeek 账户余额</span>
          <span class="dsh-balance-state" data-field="balance-state" data-tone="muted">正在读取…</span>
        </div>
        <div class="dsh-balance-list" data-field="balance-list"><p>正在连接余额接口…</p></div>
      </div>
      <div class="dsh-usage-grid">
        ${usagePeriodCard('today', '今日')}
        ${usagePeriodCard('month', '本月')}
        ${usagePeriodCard('all', '累计')}
      </div>
      <div class="dsh-usage-card dsh-usage-series">
        <div class="dsh-balance-title">
          <span>不同时段费用（估算）</span>
          <span class="dsh-balance-state" data-tone="muted">官方单价 × 本机用量</span>
        </div>
        <div class="dsh-series-columns">
          <section class="dsh-series-panel" aria-labelledby="dsh-series-days-title">
            <div class="dsh-series-panel-head">
              <div class="dsh-series-panel-title">
                <h3 id="dsh-series-days-title">近 7 天</h3>
                <span>按自然日统计</span>
              </div>
              <div class="dsh-series-total" data-field="series-days-total"></div>
            </div>
            <div class="dsh-series-table-head" aria-hidden="true"><span>日期</span><span>用量</span><span>费用</span></div>
            <div class="dsh-series-list" data-field="series-days"></div>
          </section>
          <section class="dsh-series-panel" aria-labelledby="dsh-series-price-bands-title">
            <div class="dsh-series-panel-head">
              <div class="dsh-series-panel-title">
                <h3 id="dsh-series-price-bands-title">近 24 小时</h3>
                <span>按计价时段汇总</span>
              </div>
              <div class="dsh-series-total" data-field="series-price-bands-total"></div>
            </div>
            <div data-field="series-price-bands"></div>
          </section>
        </div>
        <div class="dsh-series-note">费用按官方页面单价估算（区分高峰/空闲时段）；模型不在价格表内的请求未计入。</div>
      </div>
      <div class="dsh-usage-footnote" data-field="footnote">用量仅统计已保存在本机的会话；删除或迁移的会话不会包含在内。</div>
    </div>
    <div data-pane="recharge" hidden>
      <div class="dsh-native-recharge">
        <h3>充值</h3>
        <div class="dsh-recharge-modes" role="tablist" aria-label="充值方式">
          <button type="button" role="tab" aria-selected="true" data-recharge-mode="online">在线充值</button>
          <button type="button" role="tab" aria-selected="false" data-recharge-mode="corporate">对公汇款</button>
        </div>
        <div data-recharge-pane="online">
          <div class="dsh-recharge-field">
            <span class="dsh-recharge-label">支付金额</span>
            <div class="dsh-amounts">
              ${[10, 20, 50, 100, 300, 500].map((amount, index) => `<button type="button" data-amount="${amount}" aria-pressed="${index === 0 ? 'true' : 'false'}">¥${amount}</button>`).join('')}
              <button type="button" data-amount="custom" aria-pressed="false">自定义</button>
              <input class="dsh-custom-amount" data-field="custom-amount" type="number" min="1" step="1" placeholder="输入金额" hidden>
              <button type="button" class="dsh-price-link" data-action="pricing">查看价格</button>
            </div>
            <div class="dsh-price-notice">模型价格以 DeepSeek 官方价格页面为准，请在支付前确认实际金额。</div>
          </div>
          <div class="dsh-recharge-field">
            <span class="dsh-recharge-label">支付方式</span>
            <div class="dsh-payment-methods">
              <button type="button" class="dsh-payment-method" data-payment="alipay" aria-pressed="true"><span class="dsh-pay-logo alipay" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation"><path fill="#1677ff" d="M19.695 15.07c3.426 1.158 4.203 1.22 4.203 1.22V3.846c0-2.124-1.705-3.845-3.81-3.845H3.914C1.808.001.102 1.722.102 3.846v16.31c0 2.123 1.706 3.845 3.813 3.845h16.173c2.105 0 3.81-1.722 3.81-3.845v-.157s-6.19-2.602-9.315-4.119c-2.096 2.602-4.8 4.181-7.607 4.181-4.75 0-6.361-4.19-4.112-6.949.49-.602 1.324-1.175 2.617-1.497 2.025-.502 5.247.313 8.266 1.317a16.796 16.796 0 0 0 1.341-3.302H5.781v-.952h4.799V6.975H4.77v-.953h5.81V3.591s0-.409.411-.409h2.347v2.84h5.744v.951h-5.744v1.704h4.69a19.453 19.453 0 0 1-1.986 5.06c1.424.52 2.702 1.011 3.654 1.333m-13.81-2.032c-.596.06-1.71.325-2.321.869-1.83 1.608-.735 4.55 2.968 4.55 2.151 0 4.301-1.388 5.99-3.61-2.403-1.182-4.438-2.028-6.637-1.809"/></svg></span><span>支付宝</span></button>
              <button type="button" class="dsh-payment-method" data-payment="wechat" aria-pressed="false"><span class="dsh-pay-logo wechat" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation"><path fill="#07c160" d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg></span><span>微信支付</span></button>
            </div>
          </div>
          <button type="button" class="dsh-pay-button" data-action="pay">生成付款二维码</button>
          <button type="button" class="dsh-payment-login" data-action="payment-login" hidden>重新登录 DeepSeek</button>
          <div class="dsh-recharge-account">金额将充入登录的 DeepSeek 开放平台账户 · 现有余额 <strong data-field="recharge-balance">暂未获取</strong></div>
          <div class="dsh-payment-status" data-field="payment-status"></div>
          <div class="dsh-recharge-tips"><strong>提示</strong><br>1. 生成二维码只会后台恢复登录，不会自动打开充值网页；登录失效时请主动点击“重新登录 DeepSeek”。<br>2. 请确认登录账户与当前 API Key 属于同一账户；付款确认由支付宝或微信完成。</div>
        </div>
        <div data-recharge-pane="corporate" hidden>
          <div class="dsh-corporate-card">
            <h3>对公汇款</h3>
            <p>收款账户、附言和到账规则可能调整，请以 DeepSeek 官方充值中心展示的信息为准。</p>
            <button type="button" class="primary" data-action="corporate-official">查看官方对公汇款信息</button>
          </div>
          <div class="dsh-payment-status" data-field="corporate-status"></div>
        </div>
      </div>
    </div>
  `
  section.querySelector('[data-action="refresh"]').addEventListener('click', () => void loadUsageState(section, { announce: true }))
  for (const tab of section.querySelectorAll('[data-pane-target]')) {
    tab.addEventListener('click', () => selectUsagePane(section, tab.dataset.paneTarget))
  }
  for (const tab of section.querySelectorAll('[data-recharge-mode]')) {
    tab.addEventListener('click', () => selectRechargeMode(section, tab.dataset.rechargeMode))
  }
  for (const button of section.querySelectorAll('[data-amount]')) {
    button.addEventListener('click', () => {
      for (const candidate of section.querySelectorAll('[data-amount]')) candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false')
      section.querySelector('[data-field="custom-amount"]').hidden = button.dataset.amount !== 'custom'
    })
  }
  for (const button of section.querySelectorAll('[data-payment]')) {
    button.addEventListener('click', () => {
      for (const candidate of section.querySelectorAll('[data-payment]')) candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false')
    })
  }
  const paymentStatus = section.querySelector('[data-field="payment-status"]')
  const payButton = section.querySelector('[data-action="pay"]')
  const paymentLoginButton = section.querySelector('[data-action="payment-login"]')
  paymentLoginButton.addEventListener('click', async () => {
    paymentLoginButton.disabled = true
    paymentStatus.textContent = '正在打开 DeepSeek 官方登录页…'
    try {
      const result = await ipcRenderer.invoke('dsh-payment:login')
      if (!result.ok) throw new Error(result.error || '登录失败')
      paymentLoginButton.hidden = true
      paymentStatus.textContent = '登录成功，请重新生成付款二维码。'
    } catch (error) {
      paymentStatus.textContent = `登录失败：${error && error.message ? error.message : String(error)}`
    } finally {
      paymentLoginButton.disabled = false
    }
  })
  payButton.addEventListener('click', async () => {
    const selectedAmount = section.querySelector('[data-amount][aria-pressed="true"]')?.dataset.amount
    const amount = selectedAmount === 'custom' ? Number(section.querySelector('[data-field="custom-amount"]').value) : Number(selectedAmount)
    if (!Number.isFinite(amount) || amount < 1) {
      paymentStatus.textContent = '请输入不少于 ¥1 的有效充值金额。'
      return
    }
    const method = section.querySelector('[data-payment][aria-pressed="true"]')?.dataset.payment === 'wechat' ? 'wechat' : 'alipay'
    const payment = method === 'wechat' ? '微信支付' : '支付宝'
    payButton.disabled = true
    payButton.textContent = '正在生成…'
    paymentStatus.textContent = `正在后台生成 ¥${amount} · ${payment} 二维码…`
    try {
      const result = await ipcRenderer.invoke('dsh-payment:create-order', { amount, method })
      if (!result.ok) {
        if (['AUTH_REQUIRED', 'AUTH_CANCELLED', 'AUTH_TIMEOUT'].includes(result.code)) paymentLoginButton.hidden = false
        throw new Error(result.error || '二维码生成失败')
      }
      paymentLoginButton.hidden = true
      showPaymentQrDialog(section, result.value)
      paymentStatus.textContent = '付款二维码已生成。'
    } catch (error) {
      paymentStatus.textContent = `无法生成付款二维码：${error && error.message ? error.message : String(error)}`
    } finally {
      payButton.disabled = false
      payButton.textContent = '生成付款二维码'
    }
  })
  section.querySelector('[data-action="pricing"]').addEventListener('click', () => void openOfficialPage('pricing', paymentStatus))
  const corporateStatus = section.querySelector('[data-field="corporate-status"]')
  section.querySelector('[data-action="corporate-official"]').addEventListener('click', () => void openOfficialPage('topUp', corporateStatus))
  section.dataset.usageLoaded = 'false'
  return section
}

function activeOnlyClasses(nativeButtons) {
  const active = nativeButtons.find(button => button.getAttribute('aria-current') === 'true')
  const inactive = nativeButtons.find(button => button !== active)
  if (!active || !inactive) return []
  return [...active.classList].filter(name => !inactive.classList.contains(name))
}

function mountSettingsCustomSections(dialog) {
  const nav = dialog.querySelector(':scope > nav')
  if (!nav) return
  const nativeButtons = [...nav.querySelectorAll('button')].filter(button => !CUSTOM_NAV_IDS.has(button.id))
  if (nativeButtons.length === 0) return
  const content = [...dialog.children].find(child => child !== nav)
  if (!content) return
  const options = [...content.children].filter(child => !CUSTOM_SECTION_IDS.has(child.id)).at(-1)
  if (!options) return

  const selectedClasses = activeOnlyClasses(nativeButtons)
  const customEntries = [
    { navId: UPDATE_NAV_ID, sectionId: UPDATE_SECTION_ID, label: '软件更新', create: createUpdateSection },
    { navId: USAGE_NAV_ID, sectionId: USAGE_SECTION_ID, label: '使用情况', create: createUsageSection },
  ]

  const deactivateCustom = () => {
    delete dialog.dataset.dshDesktopSection
    options.style.removeProperty('display')
    for (const entry of customEntries) {
      const section = dialog.querySelector(`#${entry.sectionId}`)
      const button = nav.querySelector(`#${entry.navId}`)
      if (section) section.hidden = true
      if (button) {
        button.removeAttribute('aria-current')
        for (const name of selectedClasses) button.classList.remove(name)
      }
    }
  }
  for (const button of nativeButtons) {
    if (wiredNativeButtons.has(button)) continue
    wiredNativeButtons.add(button)
    button.addEventListener('click', deactivateCustom)
  }

  const activateCustom = (navButton, section) => {
    dialog.dataset.dshDesktopSection = section.id
    for (const button of [...nativeButtons, ...nav.querySelectorAll('button[id^="dsh-desktop-"]')]) {
      button.removeAttribute('aria-current')
      for (const name of selectedClasses) button.classList.remove(name)
    }
    for (const candidate of content.querySelectorAll('section[id^="dsh-desktop-"]')) candidate.hidden = candidate !== section
    navButton.setAttribute('aria-current', 'true')
    for (const name of selectedClasses) navButton.classList.add(name)
    options.style.display = 'none'
    section.hidden = false
    if (section.id === USAGE_SECTION_ID && section.dataset.usageLoaded === 'false') {
      section.dataset.usageLoaded = 'loading'
      void loadUsageState(section)
    }
  }

  for (const entry of customEntries) {
    let navButton = nav.querySelector(`#${entry.navId}`)
    let section = dialog.querySelector(`#${entry.sectionId}`)
    if ((navButton && !section) || (!navButton && section)) {
      navButton?.remove()
      section?.remove()
      navButton = null
      section = null
    }
    if (navButton) continue
    const template = nativeButtons.find(button => button.getAttribute('aria-current') !== 'true') || nativeButtons[0]
    navButton = template.cloneNode(true)
    navButton.id = entry.navId
    navButton.removeAttribute('aria-current')
    navButton.removeAttribute('data-state')
    const label = [...navButton.querySelectorAll('span')].at(-1)
    if (label) label.textContent = entry.label
    else navButton.append(entry.label)
    template.parentElement.appendChild(navButton)
    section = entry.create()
    content.appendChild(section)
    navButton.addEventListener('click', () => activateCustom(navButton, section))
  }

  // React 重新投影设置列表时可能恢复原栏目高亮；自定义栏目处于活动状态时
  // 把可见状态重新校准，不改变 React 自己记录的上一个原生栏目。
  const activeSectionId = dialog.dataset.dshDesktopSection
  if (activeSectionId && CUSTOM_SECTION_IDS.has(activeSectionId)) {
    const activeEntry = customEntries.find(entry => entry.sectionId === activeSectionId)
    const navButton = activeEntry ? nav.querySelector(`#${activeEntry.navId}`) : null
    const section = activeEntry ? dialog.querySelector(`#${activeEntry.sectionId}`) : null
    if (navButton && section) {
      activateCustom(navButton, section)
    }
  }
  syncLowBalanceIndicator()
}

function syncSettingsUpdateSections() {
  syncQueued = false
  installStyles()
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    mountSettingsCustomSections(dialog)
  }
}

function queueSync() {
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(syncSettingsUpdateSections)
}

function isHarnessPage() {
  return window.location.protocol === 'http:'
    && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
}

function mutationTouchesSettingsDialog(mutations) {
  for (const mutation of mutations) {
    const target = mutation.target instanceof Element ? mutation.target : null
    if (target?.matches('[role="dialog"]') || target?.closest('[role="dialog"]')) return true
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue
      if (node.matches('[role="dialog"]') || node.querySelector('[role="dialog"]')) return true
    }
  }
  return false
}

function start() {
  // preload 同样会运行在本地 data: 启动页。只在真正的 Harness 本地页面
  // 挂载设置、余额查询和提示，避免启动页提前出现余额警告并制造“反复刷新”错觉。
  if (!isHarnessPage()) return
  syncSettingsUpdateSections()
  void syncPriceBandBanner()
  if (priceBandTimer === null) priceBandTimer = setInterval(() => void syncPriceBandBanner(), 30000)
  new MutationObserver((mutations) => {
    if (mutationTouchesSettingsDialog(mutations)) queueSync()
    queuePriceBandBannerSync()
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['role'],
  })
  void checkLowBalanceWarning()
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
