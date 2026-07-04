import { NextResponse } from "next/server";

const RETIRED_RESPONSE = {
  error: "Online student-fee payments are retired. Please pay the school directly and contact the school admin for ledger updates.",
  code: "STUDENT_FEE_ONLINE_PAYMENT_RETIRED",
};

export async function POST() {
  return NextResponse.json(RETIRED_RESPONSE, { status: 410 });
}
