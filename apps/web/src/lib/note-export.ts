import { saveDesktopTextFile } from "@workspace/platform/desktop";

export const exportTextFile = async ({
	fileName,
	content,
}: {
	fileName: string;
	content: string;
}) => {
	const desktopResult = await saveDesktopTextFile(fileName, content);

	if (desktopResult) {
		return desktopResult;
	}

	const blob = new Blob([content], {
		type: "text/plain;charset=utf-8",
	});
	const downloadUrl = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = downloadUrl;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(downloadUrl);

	return {
		ok: true,
		canceled: false,
		filePath: fileName,
	};
};
