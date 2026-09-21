import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(2500)
await page.screenshot({ path: '.shots/d-final.jpg', type: 'jpeg', quality: 62 })
await browser.close()
console.log('done')
