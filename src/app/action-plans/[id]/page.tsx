import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ActionPlanDetailPage({ 
  params 
}: Props) {
  const { id } = await params;
  redirect(`/action-plans?expand=${id}`);
}
