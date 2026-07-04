import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    received: true,
    retired: true,
    message: "Student-fee Razorpay webhook processing is retired.",
  });
}
