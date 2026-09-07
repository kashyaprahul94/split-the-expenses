import { CreateGroup, RecentGroups } from "@/components/CreateGroup";
import { ImportGroup } from "@/components/ImportGroup";
import { Card, SectionTitle } from "@/components/ui";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-5 pt-10">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Split the expenses
        </h1>
        <p className="text-sm opacity-70">
          Share costs with a group and see who owes whom. No accounts, no
          logins — just a link you share.
        </p>
      </header>

      <Card>
        <SectionTitle>New group</SectionTitle>
        <CreateGroup />
      </Card>

      <RecentGroups />

      <Card>
        <SectionTitle>Restore a backup</SectionTitle>
        <ImportGroup />
      </Card>

      <p className="px-1 text-xs leading-relaxed opacity-50">
        Anyone with a group&apos;s link can read and edit it, like a shared
        spreadsheet. Every change is recorded in the group&apos;s activity log.
      </p>
    </main>
  );
}
