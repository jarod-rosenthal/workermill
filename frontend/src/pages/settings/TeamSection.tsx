import {
  Loader2,
  Mail,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { TeamMember, PendingInvite } from "./types";

interface TeamSectionProps {
  teamMembers: TeamMember[];
  teamMembersLoading: boolean;
  currentUser: { id: string } | null;
  isCurrentUserAdmin: boolean;
  editingMemberId: string | null;
  setEditingMemberId: (id: string | null) => void;
  handleUpdateMemberRole: (memberId: string, role: "admin" | "member" | "viewer") => void;
  updatingMemberRole: boolean;
  getRoleBadgeColor: (role: string) => string;
  confirmRemoveMember: (member: TeamMember) => void;
  removingMemberId: string | null;
  pendingInvites: PendingInvite[];
  invitesLoading: boolean;
  formatDate: (date: string) => string;
  handleResendInvite: (id: string) => void;
  resendingInviteId: string | null;
  handleRevokeInvite: (id: string) => void;
  revokingInviteId: string | null;
  setShowInviteModal: (show: boolean) => void;
}

export function TeamSection({
  teamMembers,
  teamMembersLoading,
  currentUser,
  isCurrentUserAdmin,
  editingMemberId,
  setEditingMemberId,
  handleUpdateMemberRole,
  updatingMemberRole,
  getRoleBadgeColor,
  confirmRemoveMember,
  removingMemberId,
  pendingInvites,
  invitesLoading,
  formatDate,
  handleResendInvite,
  resendingInviteId,
  handleRevokeInvite,
  revokingInviteId,
  setShowInviteModal,
}: TeamSectionProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1">Team</h2>
          <p className="text-sm text-muted-foreground">Manage your organization&apos;s members</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white text-sm font-semibold rounded-lg hover:bg-indigo-600 transition-all"
        >
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Current Members */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-500" />
          Active Members
        </h3>
        {teamMembersLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Loading team members...</span>
          </div>
        ) : teamMembers.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No team members yet. Invite someone to get started.</p>
        ) : (
          <div className="space-y-2">
            {teamMembers.map((member) => {
              const isCurrentMember = currentUser?.id === member.id;
              const canManage = isCurrentUserAdmin && !isCurrentMember;

              return (
                <div key={member.id} className="flex items-center justify-between p-4 bg-background/50 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
                      <span className="text-indigo-500 font-semibold">
                        {(member.fullName || member.email).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{member.fullName || member.email}</p>
                        {isCurrentMember && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary/20 text-primary">You</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Role selector for admins managing other members */}
                    {canManage && editingMemberId === member.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          defaultValue={member.role}
                          onChange={(e) => handleUpdateMemberRole(member.id, e.target.value as "admin" | "member" | "viewer")}
                          disabled={updatingMemberRole}
                          className="px-2 py-1 text-xs rounded-lg bg-background border border-border focus:border-primary focus:outline-none"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        {updatingMemberRole ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : (
                          <button
                            onClick={() => setEditingMemberId(null)}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Role badge - clickable for admins */}
                        {canManage ? (
                          <button
                            onClick={() => setEditingMemberId(member.id)}
                            className={`px-2 py-1 text-xs font-medium rounded-full capitalize hover:ring-2 hover:ring-primary/30 transition-all ${getRoleBadgeColor(member.role)}`}
                            title="Click to change role"
                          >
                            {member.role}
                          </button>
                        ) : (
                          <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${getRoleBadgeColor(member.role)}`}>
                            {member.role}
                          </span>
                        )}

                        {/* Remove button for admins */}
                        {canManage && (
                          <button
                            onClick={() => confirmRemoveMember(member)}
                            disabled={removingMemberId === member.id}
                            className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                            title="Remove from organization"
                          >
                            {removingMemberId === member.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending Invites */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <Mail className="w-4 h-4 text-yellow-500" />
          Pending Invites
        </h3>
        {invitesLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : pendingInvites.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No pending invites</p>
        ) : (
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/20">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-yellow-500" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {formatDate(invite.expiresAt)} | Role: <span className="capitalize">{invite.role}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleResendInvite(invite.id)}
                    disabled={resendingInviteId === invite.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-blue-500 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
                  >
                    {resendingInviteId === invite.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Resend
                  </button>
                  <button
                    onClick={() => handleRevokeInvite(invite.id)}
                    disabled={revokingInviteId === invite.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                  >
                    {revokingInviteId === invite.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
