'use strict';

// Starter content for the five levels of leadership. Everything here is
// editable in the app (Pipeline page); it is a starting point for your team
// to refine, not a finished curriculum.
//
// competencies: [category, name, description]
// trainings:    [title, description, format, required]

const levels = [
  {
    id: 1,
    name: 'Leading Self',
    focus: 'Character, faithfulness and personal capacity',
    description:
      'Every leader starts here. Serving faithfully, growing in character and following Jesus, and managing my own spiritual health and capacity before I lead anyone else.',
    typical_roles: 'Volunteer, team member',
    competencies: [
      ['Be', 'Growing in Christ', 'Has consistent spiritual habits (Scripture, prayer, community) and is growing in Christlike character.'],
      ['Be', 'Teachable', 'Receives feedback and coaching with humility and acts on it.'],
      ['Be', 'Faithful and reliable', 'Shows up prepared and on time; communicates early when unavailable.'],
      ['Know', 'Mission, vision and values', 'Can explain why our church exists and how their role connects to it.'],
      ['Know', 'Role expectations and the win', 'Knows what a win looks like for their team and role.'],
      ['Know', 'Safety and care policies', 'Understands and follows safety, child protection and care policies that apply to their role.'],
      ['Do', 'Serves with excellence', 'Does their role well and treats people with warmth.'],
      ['Do', 'Manages personal capacity', 'Keeps a sustainable rhythm of rest; says no when needed; is honest about margin.'],
      ['Do', 'Invites others to serve', 'Personally invites friends and newcomers to join the team.'],
    ],
    trainings: [
      ['Welcome to the Team: Mission, Vision & Values', 'Orientation for every new volunteer.', 'In person', 1],
      ['Safety & Child Protection', 'Required policies and reporting procedures.', 'Online', 1],
      ['Serving with Excellence', 'What great serving looks like in every ministry.', 'In person', 0],
    ],
  },
  {
    id: 2,
    name: 'Leading Others',
    focus: 'Caring for, organizing and developing a team',
    description:
      'Leads a team of volunteers. Shepherds people, organizes the work, builds team culture and is always developing an apprentice.',
    typical_roles: 'Team leader, shift lead, host, small group leader',
    competencies: [
      ['Be', "Shepherd's heart", 'Genuinely cares for the people on their team, not just the tasks.'],
      ['Be', 'Humble and secure', 'Leads from security in Christ; shares credit and owns mistakes.'],
      ['Be', 'Models the way', 'Lives out what they ask of their team.'],
      ['Know', "Team members' stories and capacity", 'Knows each person, their gifts, season of life and capacity.'],
      ['Know', 'Healthy team culture', 'Understands what makes a team healthy, fun and effective.'],
      ['Know', 'The apprenticeship process', 'Knows how to identify, invite and develop an apprentice.'],
      ['Do', 'Recruits and onboards', 'Fills the team and helps new people get connected quickly.'],
      ['Do', 'Communicates clearly', 'Communicates plans and changes early and clearly.'],
      ['Do', 'Leads great huddles', 'Runs pre-service or team gatherings that connect, inform and inspire.'],
      ['Do', 'Develops an apprentice', 'Has an apprentice and is intentionally handing off responsibility.'],
      ['Do', 'Gives feedback and resolves conflict', 'Addresses issues directly, kindly and early.'],
    ],
    trainings: [
      ['Leading Others Workshop', 'Core skills for first-time team leaders.', 'In person', 1],
      ['Apprenticeship 101', 'How to identify and develop the next leader.', 'In person', 1],
      ['Leading Great Huddles', 'Plan and run effective team huddles.', 'Video', 0],
    ],
  },
  {
    id: 3,
    name: 'Leading Leaders',
    focus: 'Coaching and multiplying leaders',
    description:
      'Leads and coaches other leaders. Success is measured by the health and growth of the leaders they coach, not by what they do themselves.',
    typical_roles: 'Coach, area leader, ministry coordinator',
    competencies: [
      ['Be', 'Multiplier mindset', 'Measures success by leaders developed rather than tasks completed.'],
      ['Be', 'Healthy under pressure', 'Maintains emotional and spiritual health when demands rise.'],
      ['Know', 'Levels 1-2 of the pipeline', 'Knows the competencies for Leading Self and Leading Others and how to assess them.'],
      ['Know', 'Coaching conversations', 'Uses a consistent framework for 1:1 coaching conversations.'],
      ['Know', 'Signs of burnout', 'Recognizes early signs of fatigue and overload in leaders.'],
      ['Do', 'Coaches leaders 1:1', 'Meets regularly with each leader they oversee.'],
      ['Do', 'Builds leader community', 'Creates community and encouragement among the leaders they coach.'],
      ['Do', 'Delegates authority', 'Hands off decisions and ownership, not just tasks.'],
      ['Do', 'Develops team leaders', 'Moves apprentices into team leadership.'],
      ['Do', 'Monitors team health and capacity', 'Watches load and health across teams and acts before people burn out.'],
    ],
    trainings: [
      ['Coaching Leaders Cohort', 'Multi-week cohort on coaching and developing leaders.', 'Cohort', 1],
      ['Caring for Leaders & Preventing Burnout', 'Spotting overload and building sustainable rhythms.', 'In person', 1],
    ],
  },
  {
    id: 4,
    name: 'Leading a Department',
    focus: 'Vision, systems and the leadership bench for a ministry',
    description:
      'Leads an entire ministry or department: sets direction, builds systems and structure, stewards resources and builds a leadership bench at every level.',
    typical_roles: 'Ministry director, department head',
    competencies: [
      ['Be', 'Kingdom perspective', 'Collaborates across ministries instead of building a silo.'],
      ['Be', 'Resilient and steady', 'Provides stability through change and difficulty.'],
      ['Know', 'Department vision and strategy', 'Can articulate where the ministry is going and why.'],
      ['Know', 'Budget and resources', 'Understands budget, facilities and staffing constraints.'],
      ['Know', 'The whole pipeline', 'Knows all levels and how to assess readiness for each.'],
      ['Do', 'Casts vision and sets goals', 'Sets clear goals and keeps the department aligned to them.'],
      ['Do', 'Designs systems for growth', 'Builds structure and processes that scale.'],
      ['Do', 'Builds a leadership bench', 'Has identified successors and apprentices at every level.'],
      ['Do', 'Evaluates effectiveness', 'Regularly measures and improves ministry effectiveness.'],
    ],
    trainings: [
      ['Department Leadership Intensive', 'Vision, strategy, systems and bench building.', 'Cohort', 1],
      ['Building Systems & Budgets', 'Planning, budgeting and structure for growth.', 'In person', 0],
    ],
  },
  {
    id: 5,
    name: 'Leading Campus/Church',
    focus: 'Aligning the whole campus or church to one mission',
    description:
      'Leads across departments: aligns the campus or church to one vision, develops department leaders, leads change and stewards organizational health.',
    typical_roles: 'Campus pastor, executive team, lead pastor',
    competencies: [
      ['Be', 'Guardian of culture', 'Protects and models the culture and values of the church.'],
      ['Be', 'Integrity and accountability', 'Invites accountability and leads with integrity.'],
      ['Be', 'Sustainable rhythm', 'Models Sabbath and sustainable leadership for the whole church.'],
      ['Know', 'Whole-church strategy', 'Understands how every ministry fits the overall strategy.'],
      ['Know', 'Organizational health', 'Knows the measures of a healthy church and its volunteer culture.'],
      ['Do', 'Aligns departments', 'Keeps every department moving in the same direction.'],
      ['Do', 'Develops department leaders', 'Coaches and develops leaders of departments.'],
      ['Do', 'Leads change', 'Leads the church through change with clarity and care.'],
      ['Do', 'Stewards volunteer capacity', 'Ensures the church asks a sustainable amount of its people.'],
    ],
    trainings: [
      ['Senior Leadership Cohort', 'Ongoing development for campus and church leaders.', 'Cohort', 1],
    ],
  },
];

module.exports = { levels };
