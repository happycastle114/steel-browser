import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("primitive showcase is reflow-safe and accessible", async ({ page }, testInfo) => {
  await page.goto("")
  await expect(page.getByRole("heading", { name: "Primitive showcase" })).toBeVisible()

  const focusButton = page.getByRole("button", { name: "Focused action" })
  await focusButton.focus()
  await expect(focusButton).toBeFocused()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations).toEqual([])

  await page.screenshot({
    fullPage: true,
    path: `../../.omo/evidence/steel-console-ui/primitive-${testInfo.project.name}.png`,
  })
})
