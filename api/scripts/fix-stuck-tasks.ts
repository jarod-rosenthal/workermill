/**
 * One-time script to fix stuck tasks
 * Run with: npx tsx scripts/fix-stuck-tasks.ts
 */
import { AppDataSource } from "../src/db/connection.js";
import { WorkerTask } from "../src/models/index.js";

async function fixStuckTasks() {
  await AppDataSource.initialize();
  console.log("Database connected");

  const taskRepo = AppDataSource.getRepository(WorkerTask);

  // Fix OCS-191 - PR #135 was approved
  const ocs191 = await taskRepo.findOne({
    where: { id: "8af306f0-90dc-437e-b514-91c8d42a548d" },
  });
  if (ocs191) {
    console.log(`Fixing OCS-191: ${ocs191.status} -> pr_approved`);
    ocs191.status = "pr_approved";
    ocs191.githubPrUrl = "https://github.com/jarod-rosenthal/pagerduty-lite/pull/135";
    ocs191.githubPrNumber = 135;
    ocs191.completedAt = new Date();
    await taskRepo.save(ocs191);
    console.log("OCS-191 fixed");
  } else {
    console.log("OCS-191 not found");
  }

  // Fix OCS-194 - PR #139 was created
  const ocs194 = await taskRepo.findOne({
    where: { id: "fea6b083-e296-4901-9f60-957fc3dd5ee5" },
  });
  if (ocs194) {
    console.log(`Fixing OCS-194: ${ocs194.status} -> review_requested`);
    ocs194.status = "review_requested";
    ocs194.githubPrUrl = "https://github.com/jarod-rosenthal/pagerduty-lite/pull/139";
    ocs194.githubPrNumber = 139;
    ocs194.completedAt = new Date();
    await taskRepo.save(ocs194);
    console.log("OCS-194 fixed");
  } else {
    console.log("OCS-194 not found");
  }

  await AppDataSource.destroy();
  console.log("Done");
}

fixStuckTasks().catch(console.error);
