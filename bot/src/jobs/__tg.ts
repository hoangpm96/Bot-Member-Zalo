import { crawlRange, findIdAtTime, findLatestId } from "./telegram-crawl.js";

const slug = "businessanalystvietnam";
const now = Date.now();
const since = now - 7 * 24 * 60 * 60 * 1000;

const latest = await findLatestId(slug, 1);
console.log("id mới nhất:", latest);
const fromId = await findIdAtTime(slug, since, { low: 1, high: latest });
console.log("id ứng với 7 ngày trước:", fromId);

for (const topicId of [440, null] as (number | null)[]) {
  const r = await crawlRange({ groupSlug: slug, fromId, toId: latest, topicId });
  console.log(`topic=${topicId ?? "mọi topic"} -> ${r.items.length} mẩu, lastId=${r.lastId}`);
  for (const it of r.items.slice(0, 3)) {
    console.log(`   • ${new Date(it.postedAt).toISOString().slice(0, 16)} | ${it.text.replace(/\s+/g, " ").slice(0, 70)}`);
  }
}
