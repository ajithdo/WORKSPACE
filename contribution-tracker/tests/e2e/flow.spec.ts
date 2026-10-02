import { expect, test, type Browser, type Page } from "@playwright/test";

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

test("setup → create project → both partners lock the plan → task done and verified → preview and assistant", async ({ browser, page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // First run: the setup wizard creates the studio and both partners.
  await page.goto("/");
  await page.fill('input[name="studio_name"]', "Two Partner Studio");
  await page.selectOption('select[name="state_code"]', "36");
  await page.check('input[name="gst_registered"]');
  await page.fill('input[name="p1_name"]', "Asha Rao");
  await page.fill('input[name="p1_email"]', "asha@studio.test");
  await page.fill('input[name="p1_password"]', "correct horse battery");
  await page.fill('input[name="p2_name"]', "Bala Kumar");
  await page.fill('input[name="p2_email"]', "bala@studio.test");
  await page.fill('input[name="p2_password"]', "correct horse staple");
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 60_000 });

  // Asha creates a brochure project for a new client.
  await page.goto("/projects/new");
  await page.fill('input[name="name"]', "Sunrise Bakery website");
  await page.fill('input[name="client_name"]', "Sunrise Bakery");
  await page.fill('input[name="quoted"]', "60000");
  await page.getByRole("button", { name: "Create project and open the plan" }).click();
  await page.waitForURL(/\/projects\/\d+\/plan/, { timeout: 60_000 });
  const projectPath = new URL(page.url()).pathname.replace(/\/plan$/, "");

  await page.getByRole("button", { name: "Send to partner to lock" }).click();
  await expect(page.getByRole("button", { name: "Withdraw to edit" })).toBeVisible();

  // Bala sees the plan in the inbox and approves it; the plan locks.
  const bala = await signIn(browser, "bala@studio.test", "correct horse staple");
  await expect(bala.getByText("Sunrise Bakery website").first()).toBeVisible();
  await bala.goto(projectPath + "/plan");
  await bala.getByRole("button", { name: "Approve and lock" }).click();
  await expect(bala.getByText(/locked/i).first()).toBeVisible();

  // The task's owner starts it, adds evidence and submits; the other partner verifies.
  await page.goto(projectPath + "/plan");
  const taskHref = await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "A-03", exact: true }) }).getByRole("link").first().getAttribute("href");
  expect(taskHref).toBeTruthy();
  await page.goto(taskHref!);
  await bala.goto(taskHref!);
  const ashaOwns = await page.getByRole("button", { name: "Start work" }).isVisible();
  const [doer, checker] = ashaOwns ? [page, bala] : [bala, page];
  await doer.getByRole("button", { name: "Start work" }).click();
  await expect(doer.getByRole("button", { name: "Add evidence" })).toBeVisible();
  await doer.selectOption('select[name="type"]', "git_commit");
  await doer.fill('input[name="external_ref"]', "4f2a9c1");
  await doer.fill('textarea[name="description"]', "Lead logged in the CRM sheet with source and status");
  await doer.check('input[name="no_secrets"]');
  await doer.getByRole("button", { name: "Add evidence" }).click();
  await expect(doer.getByRole("status").filter({ hasText: "Evidence added" })).toBeVisible();
  await doer.getByRole("button", { name: "Submit for verification" }).click();
  await expect(doer.getByRole("button", { name: "Submit for verification" })).toBeHidden();

  await checker.reload();
  await checker.getByRole("button", { name: "Verify" }).click();
  await expect(checker.getByRole("button", { name: "Verify" })).toBeHidden();
  await checker.goto(projectPath + "/contribution");
  await expect(checker.getByText(/Where the points come from/)).toBeVisible();

  // Preview tab renders the address form and the framed viewer.
  await page.goto(projectPath + "/preview");
  await expect(page.getByText("Site addresses").first()).toBeVisible();

  // Assistant tab renders and explains how to turn on the AI features when no key is set.
  await page.goto(projectPath + "/assistant");
  await expect(page.getByText(/ANTHROPIC_API_KEY/).first()).toBeVisible();

  // Client update and the yearly summary render.
  await page.goto(projectPath + "/report");
  await expect(page.getByText("Message for the client (edit before sending)")).toBeVisible();
  await page.goto("/summary");
  await expect(page.getByRole("heading", { name: "Year at a glance" })).toBeVisible();

  expect(errors).toEqual([]);
});
