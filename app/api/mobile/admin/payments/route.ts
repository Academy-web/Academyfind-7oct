import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/getSession';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const where: any = {};
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
      prisma.subscriptionPayment.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          institute: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.subscriptionPayment.count({ where }),
    ]);

    return NextResponse.json({ success: true, data: { payments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { id, status } = body;

    const payment = await prisma.subscriptionPayment.findUnique({
      where: { id },
      include: { institute: true }
    });

    if (!payment) {
      return NextResponse.json({ success: false, error: 'Payment record not found' }, { status: 404 });
    }

    if (status === 'APPROVED') {
      const { approvePayment } = await import('@/lib/User/admin/adminPaymentApprove');
      const result = await approvePayment(id, session.user.id);
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error || 'Failed to approve payment' },
          { status: (result as any).statusCode || 400 }
        );
      }
    } else if (status === 'REJECTED') {
      const { rejectPayment } = await import('@/lib/User/admin/adminPaymentApprove');
      const result = await rejectPayment(id);
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error || 'Failed to reject payment' },
          { status: (result as any).statusCode || 400 }
        );
      }
    } else {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    const updatedPayment = await prisma.subscriptionPayment.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        institute: { select: { id: true, name: true } },
      }
    });

    return NextResponse.json({ success: true, data: updatedPayment });
  } catch (error: any) {
    console.error("Mobile admin payments PUT error:", error);
    return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
