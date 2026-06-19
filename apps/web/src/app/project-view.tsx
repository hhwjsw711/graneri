import { Button } from "@workspace/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation } from "convex/react";
import { FileText } from "lucide-react";
import * as React from "react";
import type { AppUser } from "@/app/app-types";
import { NotesList } from "@/app/note-list";
import { PageTitle } from "@/components/layout/page-title";
import { logError } from "@/lib/logger";
import { optimisticUpdateProjectList } from "@/lib/optimistic-projects";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const MAX_PROJECT_DESCRIPTION_LENGTH = 255;

export function ProjectView({
	project,
	notes,
	currentNoteId,
	currentNoteTitle,
	currentUser,
	isDesktopMac,
	onOpenNote,
	onNoteTrashed,
	onCreateNote,
}: {
	project: Doc<"projects">;
	notes: Array<Doc<"notes">> | undefined;
	currentNoteId: Id<"notes"> | null;
	currentNoteTitle: string;
	currentUser: AppUser;
	isDesktopMac: boolean;
	onOpenNote: (noteId: Id<"notes">) => void;
	onNoteTrashed: (noteId: Id<"notes">) => void;
	onCreateNote: () => void;
}) {
	const projectNotes = React.useMemo(() => {
		if (!notes) {
			return notes;
		}

		return notes.filter((note) => note.projectId === project._id);
	}, [notes, project]);

	return (
		<div className="box-border flex w-full max-w-full min-w-0 justify-center px-4 pb-6 md:px-6">
			<div
				className={cn(
					"flex w-full min-w-0 max-w-5xl flex-col gap-6",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				<section className="mx-auto w-full min-w-0 space-y-6 md:max-w-xl">
					<PageTitle isDesktopMac={isDesktopMac}>{project.name}</PageTitle>
					<ProjectDescriptionEditor key={project._id} project={project} />
				</section>
				<section className="flex min-w-0 justify-center py-4">
					{projectNotes === undefined ? null : projectNotes.length > 0 ? (
						<div className="w-full md:max-w-xl">
							<NotesList
								notes={projectNotes}
								activeNoteId={currentNoteId}
								activeNoteTitle={currentNoteTitle}
								recordingNoteId={null}
								currentUser={currentUser}
								onOpenNote={onOpenNote}
								onNoteTrashed={onNoteTrashed}
							/>
						</div>
					) : (
						<Empty className="md:max-w-xl">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FileText className="size-4" />
								</EmptyMedia>
								<EmptyTitle>No notes in this project</EmptyTitle>
								<EmptyDescription>
									Create a note to add it here
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button onClick={onCreateNote}>Quick note</Button>
							</EmptyContent>
						</Empty>
					)}
				</section>
			</div>
		</div>
	);
}

function ProjectDescriptionEditor({ project }: { project: Doc<"projects"> }) {
	const [description, setDescription] = React.useReducer(
		(_current: string, next: string) => next,
		project.description,
	);
	const updateDescription = useMutation(
		api.projects.updateDescription,
	).withOptimisticUpdate((localStore, args) => {
		optimisticUpdateProjectList(localStore, args.workspaceId, (projects) =>
			projects.map((entry) =>
				entry._id === args.id
					? {
							...entry,
							description: args.description,
							updatedAt: Date.now(),
						}
					: entry,
			),
		);
	});

	const handleDescriptionChange = React.useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			setDescription(event.target.value);
		},
		[],
	);

	const handleDescriptionBlur = React.useCallback(() => {
		if (description === project.description) {
			return;
		}

		void updateDescription({
			workspaceId: project.workspaceId,
			id: project._id,
			description,
		}).catch((error) => {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update project description",
			});
			setDescription(project.description);
		});
	}, [description, project, updateDescription]);

	return (
		<Textarea
			name="project-description"
			value={description}
			maxLength={MAX_PROJECT_DESCRIPTION_LENGTH}
			placeholder="Add a description..."
			aria-label="Project description"
			rows={1}
			className="min-h-0 resize-none rounded-none border-0 bg-transparent p-0 shadow-none ring-0 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
			onBlur={handleDescriptionBlur}
			onChange={handleDescriptionChange}
		/>
	);
}
