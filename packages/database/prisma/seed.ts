import { PrismaClient } from "../generated";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create demo user
  const user = await prisma.user.upsert({
    where: { githubId: 12345678 },
    update: {},
    create: {
      githubId: 12345678,
      username: "demo-user",
      email: "demo@vibecoder.com",
      avatarUrl: "https://avatars.githubusercontent.com/u/12345678",
      planTier: "FREE",
      subscriptions: {
        create: {
          planTier: "FREE",
          reposRemaining: 1,
          chatsRemaining: 20,
          mockInterviewsRemaining: 1,
        },
      },
    },
  });

  console.log("Created user:", user.username);

  // Create sample repository
  const repo = await prisma.repository.upsert({
    where: { userId_fullName: { userId: user.id, fullName: "demo-user/sample-project" } },
    update: {},
    create: {
      userId: user.id,
      fullName: "demo-user/sample-project",
      defaultBranch: "main",
      primaryLanguage: "TypeScript",
      totalFiles: 42,
      totalLines: 5000,
      status: "READY",
      lastAnalyzedAt: new Date(),
    },
  });

  console.log("Created repository:", repo.fullName);

  // Create sample analysis job
  const job = await prisma.analysisJob.create({
    data: {
      repoId: repo.id,
      status: "SUCCEEDED",
      stage: "DONE",
      progress: 100,
      completedAt: new Date(),
    },
  });

  console.log("Created analysis job:", job.id);

  // Create sample module
  const module = await prisma.codeModule.create({
    data: {
      repoId: repo.id,
      jobId: job.id,
      name: "Authentication",
      path: "src/auth",
      purposeSummary: "Handles user authentication and authorization",
      complexityScore: 3.5,
      fileCount: 5,
      lineCount: 800,
    },
  });

  console.log("Created module:", module.name);

  // Create sample artifact
  const artifact = await prisma.artifact.create({
    data: {
      repoId: repo.id,
      jobId: job.id,
      artifactType: "architecture",
      content: {
        overview: "This is a demo project with authentication, API routes, and database integration.",
        modules: ["Authentication", "API Routes", "Database Models"],
        techStack: ["Node.js", "TypeScript", "PostgreSQL", "Redis"],
      },
      version: 1,
    },
  });

  console.log("Created artifact:", artifact.artifactType);

  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
