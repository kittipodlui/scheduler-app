import { getSessionUser } from "@/lib/auth";
import { ensureDatabase, getPool } from "@/lib/database";
import { runAlgorithmSampleBenchmarks } from "@/lib/algorithm-benchmarks";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) {
      return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }

    // This endpoint only runs synthetic examples and never touches user schedules.
    const report = runAlgorithmSampleBenchmarks();
    return Response.json({ report });
  } catch (error) {
    console.error(
      "Sample algorithm benchmark error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "ไม่สามารถรันทดสอบข้อมูลตัวอย่างได้",
      },
      { status: 500 },
    );
  }
}
