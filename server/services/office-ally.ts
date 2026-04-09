import { generate837P, type EDI837PInput } from "./edi-generator";

const OA_CONFIG = {
  host: process.env.OA_SFTP_HOST || "sftp.officeally.com",
  port: 22,
  username: process.env.OA_SFTP_USERNAME,
  password: process.env.OA_SFTP_PASSWORD,
};

function isSFTPConfigured(): boolean {
  return !!(OA_CONFIG.username && OA_CONFIG.password);
}

export async function submitClaim837P(
  claimData: EDI837PInput
): Promise<{
  success: boolean;
  filename: string;
  submittedAt: string;
  error?: string;
}> {
  if (!isSFTPConfigured()) {
    return {
      success: false,
      filename: "",
      submittedAt: new Date().toISOString(),
      error: "Office Ally SFTP credentials not configured",
    };
  }

  let sftp: any;
  try {
    const Client = (await import("ssh2-sftp-client")).default;
    sftp = new Client();
    await sftp.connect(OA_CONFIG);

    const edi = generate837P(claimData);
    const filename = `claim_${claimData.claim.id}_${Date.now()}.edi`;
    const remotePath = `/claims/outbound/${filename}`;

    await sftp.put(Buffer.from(edi), remotePath);
    await sftp.end();

    return {
      success: true,
      filename,
      submittedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    if (sftp) await sftp.end().catch(() => {});
    return {
      success: false,
      filename: "",
      submittedAt: new Date().toISOString(),
      error: err.message,
    };
  }
}

export async function retrieve277Acknowledgments(): Promise<string[]> {
  if (!isSFTPConfigured()) return [];

  let sftp: any;
  try {
    const Client = (await import("ssh2-sftp-client")).default;
    sftp = new Client();
    await sftp.connect(OA_CONFIG);
    const files = await sftp.list("/claims/acknowledgments/277/");
    const ackFiles: string[] = [];

    for (const file of files) {
      if (file.name.endsWith(".edi") || file.name.endsWith(".txt")) {
        const content = await sftp.get(
          `/claims/acknowledgments/277/${file.name}`
        );
        ackFiles.push(content.toString());
        await sftp.rename(
          `/claims/acknowledgments/277/${file.name}`,
          `/claims/acknowledgments/277/processed/${file.name}`
        );
      }
    }

    await sftp.end();
    return ackFiles;
  } catch (err) {
    if (sftp) await sftp.end().catch(() => {});
    return [];
  }
}

export async function retrieve835ERA(): Promise<string[]> {
  if (!isSFTPConfigured()) return [];

  let sftp: any;
  try {
    const Client = (await import("ssh2-sftp-client")).default;
    sftp = new Client();
    await sftp.connect(OA_CONFIG);
    const files = await sftp.list("/remittance/835/");
    const eraFiles: string[] = [];

    for (const file of files) {
      if (file.name.endsWith(".edi") || file.name.endsWith(".txt")) {
        const content = await sftp.get(`/remittance/835/${file.name}`);
        eraFiles.push(content.toString());
        await sftp.rename(
          `/remittance/835/${file.name}`,
          `/remittance/835/processed/${file.name}`
        );
      }
    }

    await sftp.end();
    return eraFiles;
  } catch (err) {
    if (sftp) await sftp.end().catch(() => {});
    return [];
  }
}
