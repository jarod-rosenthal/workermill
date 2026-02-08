/**
 * Custom Workflow Stage Icons for WorkerMill
 *
 * Literal, instantly recognizable SVG icons for workflow stages.
 * Uses currentColor for stroke to support status-based coloring.
 * ViewBox: 0 0 24 24, Stroke: 2px, Caps/Joins: round
 */

import { forwardRef, type SVGProps } from "react";

export interface WorkflowIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

/**
 * Planning Icon - Clipboard with Checklist
 * Represents task planning and preparation
 */
export const PlanningIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Clipboard outline */}
      <rect x="5" y="4" width="14" height="17" rx="2" />
      {/* Clip at top */}
      <path d="M9 2h6v3H9z" />
      {/* Checklist lines with bullets */}
      <circle cx="8" cy="10" r="1" fill="currentColor" />
      <path d="M11 10h6" />
      <circle cx="8" cy="14" r="1" fill="currentColor" />
      <path d="M11 14h6" />
      <circle cx="8" cy="18" r="1" fill="currentColor" />
      <path d="M11 18h4" />
    </svg>
  )
);
PlanningIcon.displayName = "PlanningIcon";

/**
 * Approved Icon - Bold Checkmark
 * Universal "approved" symbol
 */
export const ApprovedIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Bold checkmark */}
      <path d="M4 12l6 6L20 6" />
    </svg>
  )
);
ApprovedIcon.displayName = "ApprovedIcon";

/**
 * Experts Icon - Three People
 * Center person (larger) + 2 smaller people on sides
 */
export const ExpertsIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Center person (larger) */}
      <circle cx="12" cy="7" r="3" />
      <path d="M12 10c-3 0-5 2-5 4v2h10v-2c0-2-2-4-5-4z" />
      {/* Left person (smaller) */}
      <circle cx="4" cy="9" r="2" />
      <path d="M4 11c-2 0-3 1.5-3 3v1h4" />
      {/* Right person (smaller) */}
      <circle cx="20" cy="9" r="2" />
      <path d="M20 11c2 0 3 1.5 3 3v1h-4" />
    </svg>
  )
);
ExpertsIcon.displayName = "ExpertsIcon";

/**
 * Consolidating Icon - Funnel
 * Filter/funnel shape with dots at top showing "many → one" convergence
 */
export const ConsolidatingIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Dots at top */}
      <circle cx="6" cy="4" r="1.5" fill="currentColor" />
      <circle cx="12" cy="4" r="1.5" fill="currentColor" />
      <circle cx="18" cy="4" r="1.5" fill="currentColor" />
      {/* Funnel shape */}
      <path d="M4 8h16l-5 6v6l-6-2v-4L4 8z" />
    </svg>
  )
);
ConsolidatingIcon.displayName = "ConsolidatingIcon";

/**
 * PR Created Icon - Git Pull Request
 * Two vertical branch lines with circles, curved connecting arrow
 */
export const PRCreatedIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Source branch (left) */}
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="M6 8v8" />
      {/* Target branch (right) */}
      <circle cx="18" cy="18" r="2" />
      <path d="M18 8v8" />
      {/* PR arrow from source to target */}
      <path d="M18 8V6a2 2 0 0 0-2-2h-4" />
      <path d="M15 7l-3-3 3-3" />
    </svg>
  )
);
PRCreatedIcon.displayName = "PRCreatedIcon";

/**
 * Review Icon - Magnifying Glass + Document
 * Document with text lines, magnifying glass overlaid
 */
export const ReviewIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Document */}
      <rect x="3" y="3" width="12" height="15" rx="1" />
      <path d="M7 7h4" />
      <path d="M7 10h6" />
      <path d="M7 13h4" />
      {/* Magnifying glass */}
      <circle cx="17" cy="17" r="3" />
      <path d="M19.5 19.5L22 22" />
    </svg>
  )
);
ReviewIcon.displayName = "ReviewIcon";

/**
 * Deployed Icon - Rocket
 * Lucide-style rocket with fins and flame
 */
export const DeployedIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Rocket body */}
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      {/* Window */}
      <circle cx="15" cy="9" r="1" />
    </svg>
  )
);
DeployedIcon.displayName = "DeployedIcon";

/**
 * Steps Icon - Numbered List / Sequential Steps
 * Vertical numbered steps representing sequential work items
 */
export const StepsIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Step 1 */}
      <circle cx="6" cy="5" r="2.5" />
      <text x="6" y="6.5" textAnchor="middle" fontSize="5" fill="currentColor" stroke="none" fontWeight="bold">1</text>
      <path d="M12 5h8" />
      {/* Connector */}
      <path d="M6 7.5v2" />
      {/* Step 2 */}
      <circle cx="6" cy="12" r="2.5" />
      <text x="6" y="13.5" textAnchor="middle" fontSize="5" fill="currentColor" stroke="none" fontWeight="bold">2</text>
      <path d="M12 12h8" />
      {/* Connector */}
      <path d="M6 14.5v2" />
      {/* Step 3 */}
      <circle cx="6" cy="19" r="2.5" />
      <text x="6" y="20.5" textAnchor="middle" fontSize="5" fill="currentColor" stroke="none" fontWeight="bold">3</text>
      <path d="M12 19h6" />
    </svg>
  ),
);
StepsIcon.displayName = "StepsIcon";

/**
 * Tech Lead Review Icon - Person with Code Brackets
 * Person silhouette with </> code symbol, representing senior engineer review
 */
export const TechLeadReviewIcon = forwardRef<SVGSVGElement, WorkflowIconProps>(
  ({ className, size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Person head */}
      <circle cx="9" cy="6" r="3" />
      {/* Person body */}
      <path d="M9 9c-3.5 0-6 2.5-6 5v2h12v-2c0-2.5-2.5-5-6-5z" />
      {/* Code bracket < */}
      <path d="M18 8l-2.5 3 2.5 3" />
      {/* Code bracket > */}
      <path d="M21 8l2.5 3-2.5 3" />
    </svg>
  ),
);
TechLeadReviewIcon.displayName = "TechLeadReviewIcon";
