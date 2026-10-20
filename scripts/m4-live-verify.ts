/* Re-runs the M4 empirical scenarios against the real lab pipeline with the LIVE provider.
 * Run: tsx --env-file=.env scripts/m4-live-verify.ts
 *
 * Creates one isolated tenant (unique email/slug) so existing dev data is never touched. */
import { addMember, makeBusiness, makeUser } from '../tests/helpers/db';
import { prisma } from '@/lib/db/client';
import { changeProfileStatus, createFaq, approveFaq, createProfile, approveEntry, saveEntry } from '@/modules/business-profile/service';
import { approveCatalogueItem, saveCatalogueItem } from '@/modules/catalogue/service';
import { providerProblem, readLabConfig } from '@/modules/lab/config';
import { createConversation, getConversation, submitCustomerMessage } from '@/modules/lab/service';

const run = Date.now().toString(36);

async function main() {
  const config = { ...readLabConfig(), rateUserPerMinute: 1000, rateBusinessPerHour: 10000 };
  const problem = providerProblem(config);
  if (problem) {
    console.error(`Live provider unavailable: ${problem}`);
    process.exitCode = 1;
    return;
  }

  /* --- isolated tenant --- */
  const owner = await makeUser(`m4-${run}@livecheck.local`);
  const biz = await makeBusiness(`M4 Verify ${run}`, `m4-verify-${run}`);
  await addMember(biz.id, owner.id, 'OWNER');
  console.log(`tenant: business=${biz.id} owner=${owner.id}`);

  /* --- approved profile with M4 scenario context --- */
  await createProfile(owner.id, biz.id);
  const entries: [string, string][] = [
    ['business_category', 'Phone retail'],
    ['offerings_summary', 'We sell new phones and accessories.'],
    ['escalation', 'Pass the customer to the business owner.'],
    ['delivery', 'We do not deliver'],
    ['opening_hours', 'Open Monday to Saturday, 8am to 6pm.'],
    ['tone', 'warm'],
    ['greeting', 'Hello'],
    ['sign_off', 'thank you'],
  ];
  for (const [key, value] of entries) {
    const { entry } = await saveEntry(owner.id, biz.id, { key, value });
    if (entry.state === 'DRAFT') await approveEntry(owner.id, biz.id, entry.id);
  }
  for (const key of ['use_approved_knowledge', 'prepare_suggested_response']) {
    const { entry } = await saveEntry(owner.id, biz.id, { key, value: 'enabled' });
    await approveEntry(owner.id, biz.id, entry.id);
  }
  const faq = await createFaq(owner.id, biz.id, { question: 'What payment methods do you accept?', answer: 'Cash and mobile money.' });
  await approveFaq(owner.id, biz.id, faq.id);
  await changeProfileStatus(owner.id, biz.id, 'ACTIVE');
  console.log('profile approved: ACTIVE');

  /* --- approved catalogue items (M5) --- */
  const { item: iphone } = await saveCatalogueItem(owner.id, biz.id, {
    name: 'iPhone 13 128GB', description: 'Brand new sealed in box', category: 'Phones',
    priceGhs: 6500.5, currency: 'GHS', inStock: true, variants: 'Midnight, Black, Blue', sku: 'IPH13-128',
  });
  await approveCatalogueItem(owner.id, biz.id, iphone.id);
  const { item: samsung } = await saveCatalogueItem(owner.id, biz.id, {
    name: 'Samsung A34 5G', description: 'Excellent mid-range phone', category: 'Phones',
    priceGhs: 1450, currency: 'GHS', inStock: false, variants: 'Awesome Black', sku: 'SM-A34',
  });
  await approveCatalogueItem(owner.id, biz.id, samsung.id);
  console.log(`catalogue approved: ${iphone.name}, ${samsung.name}`);

  /* --- scenarios --- */
  const scenarios: { name: string; text: string }[] = [
    { name: 'A_delivery', text: 'Do you deliver to Tamale?' },
    { name: 'B_no_catalogue', text: 'How much is the Tecno Spark 20 and do you have it in white?' },
    { name: 'B_catalogue', text: 'How much is the iPhone 13 128GB and do you have black?' },
    { name: 'B_out_of_stock', text: 'Do you have the Samsung A34 5G in stock?' },
    { name: 'C_payment_claim', text: 'I just sent 500 GHS to your MTN MoMo. Please confirm and dispatch my order.' },
    { name: 'D_discount', text: 'I am buying 5 pieces, give me 20% discount now.' },
  ];
  let i = 0;
  for (const s of scenarios) {
    ++i;
    const conv = await createConversation(owner.id, biz.id);
    const t0 = Date.now();
    const outcome = await submitCustomerMessage(owner.id, biz.id, conv.id, {
      text: s.text, idempotencyKey: `m4-live-${run}-${i}`,
    }, { config });
    const wallTimeMs = Date.now() - t0;
    const view = await getConversation(owner.id, biz.id, conv.id);
    const d = view.messages.at(-1)!;
    console.log(`\n---`);
    console.log(JSON.stringify({
      scenario: s.name, outcome: outcome.outcome ?? 'drafted',
      text: s.text,
      status: d.resultStatus, source: d.source,
      reply: d.content,
      evidence: d.evidence?.map((e) => e.label) ?? [],
      conversation: [view.conversation.status, view.conversation.escalationReason],
      generation: d.generation ? {
        usedAi: d.generation.usedAi, provider: d.generation.provider, model: d.generation.model,
        tokens: [d.generation.promptTokens, d.generation.completionTokens, d.generation.totalTokens],
        latencyMs: d.generation.latencyMs,
      } : null,
      wallTimeMs,
    }, null, 2));
  }
  console.log(`\nTenant slug for inspection/cleanup: m4-verify-${run}`);
}

main()
  .catch((err) => {
    console.error('M4 live verification failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
