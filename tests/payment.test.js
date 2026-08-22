'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  PaymentError,
  createPaymentRequest,
  isAuthenticationUrl,
  normalizeAmount,
  parsePaymentOrder,
  parsePaymentStatus,
} = require('../src/payment')

test('only reveals actual DeepSeek or supported provider login pages', () => {
  assert.equal(isAuthenticationUrl('https://platform.deepseek.com/sign_in'), true)
  assert.equal(isAuthenticationUrl('https://accounts.google.com/o/oauth2/v2/auth'), true)
  assert.equal(isAuthenticationUrl('https://platform.deepseek.com/top_up'), false)
  assert.equal(isAuthenticationUrl('https://platform.deepseek.com/usage'), false)
})

test('builds the official CNY QR payment request without exposing credentials', () => {
  assert.deepEqual(createPaymentRequest({ amount: 20, method: 'wechat' }, 'request-id'), {
    order_info: {
      payment_method_type: 'CMB_UNIONPAY',
      fallback_method_type: 'WECHAT',
      amount: '20',
      currency: 'CNY',
      request_id: 'request-id',
    },
    terminal_type: 'WEB',
  })
})

test('validates top-up amount boundaries', () => {
  assert.equal(normalizeAmount(1), '1')
  assert.equal(normalizeAmount('10.50'), '10.50')
  assert.throws(() => normalizeAmount(0), error => error instanceof PaymentError && error.code === 'INVALID_AMOUNT')
  assert.throws(() => normalizeAmount(1.001), error => error instanceof PaymentError && error.code === 'INVALID_AMOUNT')
})

test('converts an official payment URL into a local QR image', () => {
  const order = parsePaymentOrder({
    code: 0,
    data: {
      biz_code: 0,
      biz_data: {
        payment_order_id: 'order-1234',
        url: 'https://pay.example.test/order/1234',
      },
    },
  }, 'alipay', 10)
  assert.equal(order.orderId, 'order-1234')
  assert.equal(order.method, 'alipay')
  assert.equal(order.amount, '10')
  assert.match(order.qrDataUrl, /^data:image\/gif;base64,/)
})

test('surfaces expired platform authentication without creating a QR code', () => {
  assert.throws(
    () => parsePaymentOrder({ code: 40003 }, 'alipay', 10),
    error => error instanceof PaymentError && error.code === 'AUTH_REQUIRED',
  )
})

test('normalizes official payment status responses', () => {
  assert.equal(parsePaymentStatus({ code: 0, data: { biz_data: { order: { status: 'success' } } } }), 'SUCCESS')
  assert.equal(parsePaymentStatus({ code: 0, data: { biz_data: { order: { status: 'created' } } } }), 'CREATED')
})
