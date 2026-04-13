"use client";

import { signOut } from "next-auth/react";
import { LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  school: { name: string };
  user: { name?: string | null; email?: string | null };
}

export default function Header({ school, user }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <h1 className="text-sm text-gray-500">{school.name}</h1>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-blue-600" />
          </div>
          <span className="font-medium">{user.name}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-gray-500 gap-1.5"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
