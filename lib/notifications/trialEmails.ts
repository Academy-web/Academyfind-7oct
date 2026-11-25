export const APPROVAL_WITH_TRIAL_SUBJECT =
  "Your Institute Is Now Live on AcademyFind – Explore Your 7-Day Free Trial!";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildApprovalWithTrialEmailHtml(params: {
  instituteName: string;
  publicListingUrl: string;
  managerDashboardUrl: string;
}): string {
  const name = escapeHtml(params.instituteName);
  const publicUrl = escapeHtml(params.publicListingUrl);
  const managerUrl = escapeHtml(params.managerDashboardUrl);

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; color: #1e293b; line-height: 1.65; background-color: #ffffff; padding: 24px;">
    <div style="text-align: center; padding: 16px 0 24px 0; border-bottom: 1px solid #fde68a;">
      <h1 style="color: #d97706; margin: 0; font-size: 26px; letter-spacing: -0.5px;">AcademyFind</h1>
    </div>

    <div style="padding-top: 24px;">
      <p style="margin: 0 0 16px 0;">Dear <strong>${name}</strong> Team,</p>

      <p style="margin: 0 0 16px 0;"><strong>Congratulations! Your institute has been approved and is now live on AcademyFind.</strong></p>

      <p style="margin: 0 0 16px 0;">Welcome to AcademyFind – a technology-enabled education discovery and management platform designed to help coaching institutes, tuition centres and educational organisations attract students, build credibility and manage their growth.</p>

      <p style="margin: 0 0 24px 0;">Your institute now has an opportunity to reach students and parents actively searching for educational opportunities.</p>

      <h3 style="color: #0f172a; font-size: 18px; margin: 24px 0 12px 0; border-bottom: 2px solid #fef3c7; padding-bottom: 6px;">Your institute links</h3>

      <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 16px; margin-bottom: 14px;">
        <p style="margin: 0 0 6px 0;"><strong>1. View Your Public Institute Profile</strong></p>
        <p style="margin: 0 0 10px 0; word-break: break-all;">
          <a href="${publicUrl}" style="color: #b45309; font-weight: bold; text-decoration: underline;">${publicUrl}</a>
        </p>
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #475569;">Share your profile with students and parents. Let them explore your courses, faculty, facilities, achievements, reviews and other information.</p>
        <a href="${publicUrl}" style="display: inline-block; background-color: #1e293b; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 13px;">Open Institute Profile</a>
      </div>

      <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 0 0 6px 0;"><strong>2. Access Your Manager Dashboard</strong></p>
        <p style="margin: 0 0 10px 0; word-break: break-all;">
          <a href="${managerUrl}" style="color: #b45309; font-weight: bold; text-decoration: underline;">${managerUrl}</a>
        </p>
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #475569;">Log in to manage your institute, enquiries, profile, promotions and other available features.</p>
        <a href="${managerUrl}" style="display: inline-block; background-color: #d97706; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 13px;">Open Manager Dashboard</a>
      </div>

      <h3 style="color: #0f172a; font-size: 18px; margin: 28px 0 14px 0; border-bottom: 2px solid #fef3c7; padding-bottom: 6px;">Explore the important features of AcademyFind</h3>

      <p style="margin: 0 0 6px 0;"><strong>1. Institute Discovery &amp; Online Visibility</strong></p>
      <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #334155;">
        <li>Get discovered by students searching by course, category and location.</li>
        <li>Build your institute's digital presence.</li>
        <li>Improve visibility through available promotional and featured listing options.</li>
      </ul>

      <p style="margin: 0 0 6px 0;"><strong>2. Professional Institute Profile</strong></p>
      <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #334155;">
        <li>Showcase courses, batches, faculty, facilities and infrastructure.</li>
        <li>Upload photographs and videos.</li>
        <li>Display achievements, results, testimonials and special offers.</li>
        <li>Keep your institute information updated.</li>
      </ul>

      <p style="margin: 0 0 6px 0;"><strong>3. CRM – Manage Your Student Enquiries</strong></p>
      <p style="margin: 0 0 8px 0; color: #334155;">Take control of your prospective student enquiries through AcademyFind's CRM capabilities.</p>
      <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #334155;">
        <li>Capture and organise student enquiries.</li>
        <li>Track prospective students and their enquiry history.</li>
        <li>Monitor follow-ups and maintain communication records.</li>
        <li>Manage leads through your dashboard.</li>
        <li>Support team-based enquiry management and coordination.</li>
      </ul>

      <p style="margin: 0 0 6px 0;"><strong>4. Lead Management &amp; Student Connections</strong></p>
      <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #334155;">
        <li>Receive enquiries from students interested in your offerings.</li>
        <li>Access enquiry information through your manager dashboard.</li>
        <li>Respond to prospective students and manage follow-ups.</li>
        <li>Build relationships with potential admissions.</li>
      </ul>

      <p style="margin: 0 0 6px 0;"><strong>5. Reviews, Ratings &amp; Credibility</strong></p>
      <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #334155;">
        <li>Build your institute's reputation through student feedback.</li>
        <li>Allow prospective students to explore available reviews and ratings.</li>
        <li>Establish greater transparency and trust.</li>
      </ul>

      <p style="margin: 0 0 6px 0;"><strong>6. Analytics &amp; Performance Insights</strong></p>
      <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #334155;">
        <li>Explore available profile and performance analytics.</li>
        <li>Understand how students interact with your institute's presence.</li>
        <li>Use insights to improve your digital outreach.</li>
      </ul>

      <p style="margin: 0 0 6px 0;"><strong>7. Promotions &amp; Institute Notice Board</strong></p>
      <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #334155;">
        <li>Publish admission announcements and new batch updates.</li>
        <li>Showcase discounts, offers and important notices.</li>
        <li>Keep students informed about your institute's activities.</li>
      </ul>

      <p style="margin: 0 0 6px 0;"><strong>8. Student &amp; Teacher Community</strong></p>
      <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #334155;">
        <li>Connect with students, teachers and educators.</li>
        <li>Participate in educational discussions and forums.</li>
        <li>Encourage engagement through community features and content.</li>
      </ul>

      <p style="margin: 0 0 6px 0;"><strong>9. Enhanced Visibility &amp; Subscription Benefits</strong></p>
      <p style="margin: 0 0 24px 0; color: #334155;">Explore available subscription plans to access additional promotional opportunities, enhanced visibility, advanced features and management capabilities.</p>

      <div style="margin: 28px 0; padding: 24px; background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border: 1px solid #f59e0b; border-radius: 12px;">
        <h3 style="margin: 0 0 10px 0; color: #92400e; font-size: 19px;">Your 7-Day Free Trial Is Waiting!</h3>
        <p style="margin: 0 0 12px 0; color: #78350f;">We also offer a <strong>one-week free subscription trial</strong> so you can explore the benefits of AcademyFind before deciding on a paid subscription.</p>
        <ul style="margin: 0 0 14px 0; padding-left: 20px; color: #78350f;">
          <li>No payment required.</li>
          <li>No credit or debit card details required.</li>
          <li>Available to institutes currently on the Basic plan.</li>
          <li>You can activate it whenever convenient from your Manager Dashboard.</li>
        </ul>
        <p style="margin: 0 0 16px 0; color: #78350f;">Simply log in to your <strong>Manager Dashboard</strong>, locate the free subscription offer and activate your 7-day trial.</p>
        <div style="text-align: center;">
          <a href="${managerUrl}" style="display: inline-block; background-color: #d97706; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">Go to Manager Dashboard &amp; Activate Trial</a>
        </div>
      </div>

      <p style="margin: 0 0 16px 0;">We encourage you to make the most of this opportunity and explore the features available to help your institute improve its visibility, manage enquiries and connect with more students.</p>

      <p style="margin: 0 0 24px 0;"><strong>Great education deserves to be discovered. Let's help students find you!</strong></p>

      <p style="margin: 0; color: #475569; font-size: 14px;">
        Warm regards,<br/>
        <strong>Team AcademyFind</strong><br/>
        <a href="https://www.academyfind.com" style="color: #b45309; text-decoration: none;">www.academyfind.com</a><br/>
        9045699938
      </p>
    </div>
  </div>
  `;
}

export function buildTrialCampaignEmailHtml(params: {
  instituteName: string;
  managerName: string;
  activationUrl: string;
}): string {
  const inst = escapeHtml(params.instituteName);
  const mgr = escapeHtml(params.managerName || "Manager");
  const url = escapeHtml(params.activationUrl);

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.65; background-color: #ffffff; padding: 24px;">
    <div style="text-align: center; padding: 16px 0 20px 0; border-bottom: 1px solid #fde68a;">
      <h1 style="color: #d97706; margin: 0; font-size: 24px;">AcademyFind</h1>
    </div>
    <div style="padding-top: 24px;">
      <h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 20px;">Unlock 7 Days of Elite (ULTRA) Free for ${inst}</h2>
      <p style="margin: 0 0 16px 0;">Hello <strong>${mgr}</strong>,</p>
      <p style="margin: 0 0 16px 0;">We've unlocked a complimentary <strong>7-Day Elite (ULTRA) Free Trial</strong> for <strong>${inst}</strong> — no credit or debit card required.</p>
      <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 18px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0; font-weight: bold; color: #92400e;">What you get for 7 days:</p>
        <ul style="margin: 0; padding-left: 20px; color: #78350f; font-size: 14px;">
          <li><strong>Top Position</strong> in your area &amp; category search results</li>
          <li><strong>Lead Management System (LMS)</strong> &amp; real-time student enquiries</li>
          <li><strong>Visitor Contact Details</strong> even when visitors don't submit a form</li>
          <li><strong>Full Showcase:</strong> up to 50 faculty, classroom gallery, results &amp; videos</li>
        </ul>
      </div>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${url}" style="display: inline-block; background-color: #d97706; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px;">Start My 7-Day Free Trial</a>
      </div>
      <p style="margin: 0 0 16px 0; font-size: 13px; color: #64748b;">After 7 days, if you choose not to upgrade, your institute simply moves back to the Basic plan with all your uploaded data intact.</p>
      <p style="margin: 0; color: #475569; font-size: 14px;">Warm regards,<br/><strong>Team AcademyFind</strong><br/>www.academyfind.com</p>
    </div>
  </div>
  `;
}

export function buildTrial48hReminderEmailHtml(params: {
  instituteName: string;
  managerName: string;
  daysRemaining: number;
  expiresAtFormatted: string;
  subscriptionUrl: string;
}): string {
  const inst = escapeHtml(params.instituteName);
  const mgr = escapeHtml(params.managerName || "Manager");
  const url = escapeHtml(params.subscriptionUrl);
  const exp = escapeHtml(params.expiresAtFormatted);

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.65; background-color: #ffffff; padding: 24px;">
    <div style="text-align: center; padding: 16px 0 20px 0; border-bottom: 1px solid #fde68a;">
      <h1 style="color: #d97706; margin: 0; font-size: 24px;">AcademyFind</h1>
    </div>
    <div style="padding-top: 24px;">
      <h2 style="margin: 0 0 12px 0; color: #92400e;">Your Elite Trial Ends in ${params.daysRemaining <= 1 ? "24 Hours" : "48 Hours"}</h2>
      <p style="margin: 0 0 16px 0;">Hello <strong>${mgr}</strong>,</p>
      <p style="margin: 0 0 16px 0;">Your 7-day Elite (ULTRA) free trial for <strong>${inst}</strong> is scheduled to end on <strong>${exp}</strong>.</p>
      <p style="margin: 0 0 16px 0;">When your trial ends, your profile and uploaded data remain safe on the Basic plan, but top search ranking, real-time student leads, and visitor contact details will pause.</p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${url}" style="display: inline-block; background-color: #d97706; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px;">Choose a Plan &amp; Keep Your Leads</a>
      </div>
      <p style="margin: 0; color: #475569; font-size: 14px;">Warm regards,<br/><strong>Team AcademyFind</strong><br/>www.academyfind.com</p>
    </div>
  </div>
  `;
}

export function buildTrialExpiredEmailHtml(params: {
  instituteName: string;
  managerName: string;
  subscriptionUrl: string;
}): string {
  const inst = escapeHtml(params.instituteName);
  const mgr = escapeHtml(params.managerName || "Manager");
  const url = escapeHtml(params.subscriptionUrl);

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.65; background-color: #ffffff; padding: 24px;">
    <div style="text-align: center; padding: 16px 0 20px 0; border-bottom: 1px solid #fde68a;">
      <h1 style="color: #d97706; margin: 0; font-size: 24px;">AcademyFind</h1>
    </div>
    <div style="padding-top: 24px;">
      <h2 style="margin: 0 0 12px 0; color: #0f172a;">Your 7-Day Elite Trial Has Ended</h2>
      <p style="margin: 0 0 16px 0;">Hello <strong>${mgr}</strong>,</p>
      <p style="margin: 0 0 16px 0;">Your 7-day Elite free trial for <strong>${inst}</strong> has ended, and your institute has been moved back to the <strong>Basic</strong> plan.</p>
      <p style="margin: 0 0 16px 0;">Don't worry — all your profile details, faculty, and media are safely preserved. You can upgrade anytime to restore top search ranking, student leads, and LMS access.</p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${url}" style="display: inline-block; background-color: #1e293b; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px;">Restore Elite / View Plans</a>
      </div>
      <p style="margin: 0; color: #475569; font-size: 14px;">Warm regards,<br/><strong>Team AcademyFind</strong><br/>www.academyfind.com</p>
    </div>
  </div>
  `;
}
