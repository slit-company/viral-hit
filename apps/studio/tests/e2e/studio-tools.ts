import { expect, type Page } from '@playwright/test';
/** Select by catalog metadata, including models belonging to another provider. */
export async function selectStudioModel(page: Page, nameOrId: string) {
  const { models } = await (await page.request.get('/api/app/effects/models')).json();
  const model = models.find((item: { id: string; name: string }) => item.id === nameOrId || item.name === nameOrId);
  expect(model, `Expected catalog model ${nameOrId}`).toBeTruthy();
  await page.getByLabel('API 제공업체', { exact: true }).selectOption(model.providerId);
  await page.getByLabel('작업 모델', { exact: true }).selectOption(model.id);
}
