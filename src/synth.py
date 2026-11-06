#!/usr/bin/env python3
"""Fictional LinkedIn export for the public demo (stdlib only, seeded, no real people or companies).
Usage: python src/synth.py [--check data]  ->  demo/data/{Connections,Positions}.csv + demo/truth.csv"""
import csv, os, random, sys
from datetime import date, datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREAMBLE = 'Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"\n\n'
HEADER = ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On']
FIRST = ('Amara Bilal Chiara Dmitri Elif Farah Goran Hana Ines Jonas Kavya Lucas Maren Nikhil Olu Priya Quentin Rosa '
         'Sven Tariq Ugo Vera Wen Ximena Yusuf Zofia Aiko Bruno Camille Dario Esme Felix Greta Hugo Ilse Jamal Keira '
         'Leif Mira Nadia Oskar Paloma Rafael Selin Tomas Uma Valentin Wanjiru Yara Zane Anouk Bastian Carys Dev Emeka '
         'Freya Ignacio Juno Kofi Linnea Mateo Noor Pavel Rhea Soren Thandiwe Viktor Ama Ciaran Daria Elio Femi Ingrid').split()
LAST = ('Abernethy Bakshi Castellano Dragomir Eskildsen Fairbairn Gallardo Halvorsen Ishikawa Jankowski Kariuki '
        'Lindqvist Mbeki Nakashima Okonkwo Pellegrini Quintero Rasmussen Szabo Tanaka Uchenna Vasquez Wojcik Xiong '
        'Yilmaz Zielinski Achterberg Coutinho Delacroix Ekwueme Fonseca Grimaldi Haddad Iversen Jovanovic '
        'Kowalczyk Lombardi Nyberg Oyelaran Petrakis Ravindran Sorensen Takahashi Varga Whitlock Adeyemi '
        'Bergstrom Cardenas Duvall Engstrom Ferreira Gunawardena Hollis Iwasaki Kaminski Lachance Marchetti Novak '
        'Ostrowski Pacheco Rinaldi Sandoval Thorvald Valcourt Wexford Yamamoto Zamora Arceneaux Blomqvist Chandran').split()
W1 = ('Amberly Birchwood Cobblestone Duskwood Elmstead Fernhollow Glimmer Harrowfield Ivybridge Juniper Kestrel '
      'Larkspur Moorland Nettlefield Orchardine Pinecrest Quarrystone Ravenmoor Saltmarsh Thistledown Umberly '
      'Violetta Willowmere Yarrowby Zephyrine Bramblecote Copperleaf Driftmoor Emberly Foxglove Gorsemere '
      'Hazelbrook Inkwell Jasperline Lanternfly Marigold Nimbusly Oakhaven Pebblecreek').split()
W2 = ('Analytics Freight Labs Works Dynamics Health Robotics Studio Systems Ventures Logistics Software Partners '
      'Energy Insights Mobility Foods Finance Digital Collective Bio Networks Data Cloudworks').split()
DENY = {'google', 'microsoft', 'amazon', 'meta', 'apple', 'oracle', 'ibm',
        'linkedin', 'netflix', 'uber', 'shell', 'deloitte', 'accenture', 'salesforce', 'nvidia', 'intel', 'tesla'}
TITLES = {
    'colleague': ['Software Engineer', 'Senior Software Engineer', 'Product Designer', 'Data Scientist', 'Engineering Manager',
                  'Product Manager', 'QA Engineer', 'Data Engineer', 'Staff Engineer', 'UX Researcher',
                  'Customer Success Manager', 'Head of Engineering', 'Frontend Developer', 'Marketing Manager'],
    'uni': ['PhD Candidate', 'Research Fellow', 'Consultant', 'Analyst', 'Software Engineer', 'Policy Advisor',
            'Teacher', 'Associate', 'Account Manager', 'Founder', 'Data Analyst', 'Operations Manager'],
    'meetup': ['Machine Learning Engineer', 'Data Scientist', 'Analytics Engineer', 'Founder', 'Developer Advocate',
               'Data Engineer', 'CTO', 'Co-founder & CEO', 'Senior Data Scientist', 'Head of Data'],
    'client': ['Operations Manager', 'Fleet Planning Lead', 'Head of Logistics', 'Procurement Manager',
               'IT Project Manager', 'Supply Chain Analyst', 'Warehouse Systems Lead', 'Director of Operations'],
    'recruiter': ['Talent Partner', 'Senior Talent Acquisition Partner', 'Technical Recruiter', 'Recruitment Consultant',
                  'Talent Acquisition Lead', 'Executive Search Consultant', 'Senior Talent Partner'],
    'noise': ['Account Executive', 'Sales Director', 'Financial Analyst', 'Architect', 'Nurse', 'Lawyer', 'Designer',
              'Business Development Manager', 'Chief Operating Officer', 'Software Developer', 'HR Business Partner',
              'Lecturer', 'Project Manager', 'Freelance Photographer', 'Product Owner', 'Student'],
}
# ego positions: company, title, start, end (None = current), location, description
EGO = [('Fernhollow Logistics', 'Graduate Operations Analyst', date(2014, 9, 1), date(2016, 7, 1), 'Leeds', 'Route planning and reporting.'),
       ('Brightwater Analytics', 'Data Analyst', date(2016, 8, 1), date(2019, 2, 1), 'Manchester', 'Dashboards and forecasting for retail clients.'),
       ('Quillmere Studio', 'Product Analyst', date(2019, 3, 1), date(2020, 12, 1), 'London', 'Experimentation and product metrics.'),
       ('Northwind Labs', 'Senior Product Manager', date(2021, 1, 1), date(2023, 6, 1), 'London', 'Led the planning tools squad.'),
       ('Tidewell Systems', 'Lead Product Manager', date(2023, 7, 1), date(2024, 8, 1), 'Bristol', 'Owned the freight client programme.'),
       ('Ashgrove Mobility', 'Head of Product', date(2024, 9, 1), None, 'London', 'Product for fleet electrification.')]
VARIANTS = {'Northwind Labs': [('Northwind Labs', 70), ('Northwind Labs Ltd', 15), ('NorthWind', 10), ('Northwind Labs, Inc.', 5)],
            'Ashgrove Mobility': [('Ashgrove Mobility', 80), ('Ashgrove Mobility Ltd', 12), ('AshGrove', 8)],
            'Brightwater Analytics': [('Brightwater Analytics', 85), ('Brightwater', 15)],
            'Halcyon Freight': [('Halcyon Freight', 75), ('Halcyon Freight Group', 15), ('Halcyon', 10)],
            'Lakemoor University': [('Lakemoor University', 85), ('University of Lakemoor', 15)]}
AGENCIES = ['Kestrel Talent', 'Bluebell Search Partners', 'Harbourline Recruitment', 'Tallowmere Talent', 'Northgate People']
MEETUPS = [date(2018, 3, 15), date(2019, 5, 22), date(2022, 10, 12), date(2023, 11, 8), date(2025, 4, 10), date(2026, 6, 18)]
END = date(2026, 10, 30)


def gen(seed=42, bad=frozenset(), scale=1.0):
    """Return (rows, truth, positions). `bad` holds lowercased names/companies to avoid (privacy collisions).
    `scale` multiplies every group size (tests/grid.py); scale 1 draws exactly the published demo."""
    rng = random.Random(seed)
    n = lambda k: max(1, round(k * scale))
    ok = lambda s: s.lower() not in bad and not any(d in s.lower() for d in DENY)
    firsts, lasts = [f for f in FIRST if ok(f)], [l for l in LAST if ok(l)]
    used_co, used_names = set(VARIANTS) | set(AGENCIES) | {p[0] for p in EGO}, set()

    def fresh():  # a never-used fictional company -> singleton
        for tries in range(10**6):
            c = f'{rng.choice(W1)} {rng.choice(W2)}'
            if tries > 60:  # ~975 two-word names run out at large scales; never reached at scale 1
                c += f' {rng.randrange(2, 10**4)}'
            if c not in used_co and ok(c):
                used_co.add(c)
                return c
    moved = [fresh() for _ in range(n(22))]  # where people move on to; zipf-ish, so small shared groups form
    meet = [fresh() for _ in range(n(12))]
    pick = lambda pool: rng.choices(pool, weights=[1 / (i + 3) for i in range(len(pool))])[0]

    def anchor(base):
        vs = [(v, w) for v, w in VARIANTS[base] if ok(v)]
        if not vs:
            sys.exit(f'synth: anchor company blocked by deny/privacy list (anchor #{list(VARIANTS).index(base)})')
        return rng.choices([v for v, _ in vs], [w for _, w in vs])[0]
    day = lambda a, b: a + timedelta(days=rng.randrange(max(1, (b - a).days)))

    def person(circle, company, kind, when):
        while True:
            f, l = rng.choice(firsts), rng.choice(lasts)
            if (f, l) not in used_names:
                used_names.add((f, l))
                break
        url = f'https://www.linkedin.com/in/{f.lower()}-{l.lower()}-{rng.getrandbits(16):04x}'
        email = f'{f.lower()}.{l.lower()}@example.com' if rng.random() < 0.01 else ''
        return circle, [f, l, url, email, company, rng.choice(TITLES[kind]), min(when, END)]

    out = []
    def era(base, k, stay, s, e, burst_share, circle):  # colleagues; burst right after joining
        for _ in range(n(k)):
            co = anchor(base) if rng.random() < stay else (pick(moved) if rng.random() < 0.8 else fresh())
            when = day(s, s + timedelta(days=26)) if rng.random() < burst_share else day(s, e)
            out.append(person(circle, co, 'colleague', when))
    era('Brightwater Analytics', 15, 0.2, date(2016, 8, 1), date(2019, 2, 1), 0.3, 'early_employer')
    era('Northwind Labs', 50, 0.45, date(2021, 1, 4), date(2023, 6, 30), 0.4, 'former_employer')
    era('Ashgrove Mobility', 45, 0.9, date(2024, 9, 2), END, 0.6, 'current_employer')
    for _ in range(n(30)):  # university cohort: connected around graduation, now everywhere
        r = rng.random()
        co = anchor('Lakemoor University') if r < 0.15 else (pick(moved) if r < 0.75 else fresh())
        when = day(date(2016, 5, 20), date(2016, 7, 15)) if rng.random() < 0.5 else day(date(2016, 1, 1), date(2018, 6, 1))
        out.append(person('university', co, 'uni', when))
    for _ in range(n(35)):  # meetup scene: bursts in the week after each event
        co = pick(meet) if rng.random() < 0.75 else fresh()
        ev = rng.choice(MEETUPS)
        out.append(person('meetup', co, 'meetup', ev + timedelta(days=rng.randrange(8))))
    for _ in range(n(20)):  # client during the Tidewell era, kickoff burst Oct 2023
        co = anchor('Halcyon Freight') if rng.random() < 0.8 else fresh()
        when = day(date(2023, 10, 2), date(2023, 10, 20)) if rng.random() < 0.5 else day(date(2023, 7, 1), date(2024, 8, 31))
        out.append(person('client', co, 'client', when))
    for _ in range(n(25)):  # recruiters: agencies (shared) or in-house at singletons, around job changes
        co = rng.choice(AGENCIES) if rng.random() < 0.6 else fresh()
        p = rng.choice(EGO[1:])[2]
        when = day(p - timedelta(days=120), p) if rng.random() < 0.6 else day(date(2017, 1, 1), END)
        out.append(person('recruiters', co, 'recruiter', when))
    seen = []
    for _ in range(n(80)):  # background noise: mostly singletons (some pairs), steady trickle weighted to recent years
        co = rng.choice(seen) if seen and rng.random() < 0.3 else fresh()
        seen.append(co)
        y = rng.choices(range(2016, 2027), weights=range(1, 12))[0]
        out.append(person('noise', co, 'noise', day(date(y, 1, 1), date(y, 12, 31))))

    out.sort(key=lambda t: t[1][6], reverse=True)  # real exports list newest first
    rows = [r[:6] + [r[6].strftime('%d %b %Y')] for _, r in out]
    pos = [[c, t, d, loc, s.strftime('%b %Y'), e.strftime('%b %Y') if e else ''] for c, t, s, e, loc, d in reversed(EGO)]
    return rows, [c for c, _ in out], pos


def write(rows, truth, pos, out=os.path.join(ROOT, 'demo')):
    os.makedirs(os.path.join(out, 'data'), exist_ok=True)
    with open(os.path.join(out, 'data', 'Connections.csv'), 'w', newline='', encoding='utf-8') as f:
        f.write(PREAMBLE)
        w = csv.writer(f, lineterminator='\n')
        w.writerow(HEADER)
        w.writerows(rows)
    with open(os.path.join(out, 'data', 'Positions.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['Company Name', 'Title', 'Description', 'Location', 'Started On', 'Finished On'])
        w.writerows(pos)
    with open(os.path.join(out, 'truth.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['id', 'circle'])
        w.writerows(enumerate(truth))
    for name, (head, body) in gen_layers(rows, truth).items():
        with open(os.path.join(out, 'data', name), 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f, lineterminator='\n')
            w.writerow(head)
            w.writerows(body)


# Layer data (skills, endorsements, follows, events, groups, posts). Own RNG so Connections.csv and metrics don't move.
SKILLS = {'early_employer': ['SQL', 'Forecasting', 'Data Analysis'], 'former_employer': ['Product Management', 'Experimentation', 'Roadmapping'],
          'current_employer': ['Product Strategy', 'Electrification', 'Roadmapping'], 'university': ['Statistics', 'Data Analysis'],
          'meetup': ['Machine Learning', 'Python', 'Statistics'], 'client': ['Logistics', 'Stakeholder Management'],
          'recruiters': [], 'noise': ['Leadership']}
GROUPS = ['Product Analytics Circle', 'Fleet Electrification Forum', 'Lakemoor University Alumni', 'Machine Learning Practitioners',
          'Logistics Leaders Network', 'Weekend Cyclists']
TAGS = ['productmanagement', 'electrification', 'machinelearning', 'logistics', 'experimentation', 'hiring']
POSTS = ['What we learned shipping {s} at scale #{t}', 'Three mistakes I made with {s} this year #{t}',
         'Notes from the meetup: {s} and why it matters #{t} #{u}', 'We are hiring! Looking for people who love {s} #hiring',
         'A short thread on {s} for fleet teams #{t}']


def gen_layers(rows, truth, seed=7):
    """-> {file name: (header, rows)} built on the demo connections."""
    rng = random.Random(seed)
    stamp = lambda d: d.strftime('%Y/%m/%d %H:%M:%S UTC')
    skills = sorted({k for v in SKILLS.values() for k in v})
    rec, given = [], []
    for r, c in zip(rows, truth):
        when = datetime.strptime(r[6], '%d %b %Y').date()
        for sk in SKILLS[c]:
            if rng.random() < 0.35:
                rec.append([stamp(when + timedelta(days=rng.randrange(30, 700))), sk, r[0], r[1], r[2], 'ACCEPTED'])
            if rng.random() < 0.06:
                given.append([stamp(when + timedelta(days=rng.randrange(30, 700))), sk, r[0], r[1], r[2], 'ACCEPTED'])
    for _ in range(12):  # endorsements from people outside the 1st-degree network
        rec.append([stamp(date(2022, 1, 1) + timedelta(days=rng.randrange(1400))), rng.choice(skills), rng.choice(FIRST), 'Outsider', '', 'ACCEPTED'])
    shares, comments = [], []
    for k in range(28):
        sk, t, u = rng.choice(skills), rng.choice(TAGS), rng.choice(TAGS)
        d = date(2019, 1, 1) + timedelta(days=rng.randrange((END - date(2019, 1, 1)).days))
        shares.append([d.strftime('%Y-%m-%d %H:%M:%S'), f'https://www.linkedin.com/feed/update/urn:li:share:{k}', rng.choice(POSTS).format(s=sk, t=t, u=u), '', '', 'MEMBER_NETWORK'])
    for k in range(40):
        d = date(2020, 1, 1) + timedelta(days=rng.randrange((END - date(2020, 1, 1)).days))
        msg = rng.choice(['Great point on {s}!', 'Congrats on the launch', 'This is how we do {s} too #{t}', 'Thanks for sharing'])
        comments.append([d.strftime('%Y-%m-%d %H:%M:%S'), f'https://www.linkedin.com/feed/update/urn:li:activity:{k}', msg.format(s=rng.choice(skills), t=rng.choice(TAGS))])
    reacts = [[(date(2020, 1, 1) + timedelta(days=rng.randrange(2400))).strftime('%Y-%m-%d %H:%M:%S'), rng.choice(['LIKE', 'PRAISE', 'INTEREST']),
               f'https://www.linkedin.com/feed/update/urn:li:activity:{k}'] for k in range(150)]
    follows = [[c, (date(2018, 1, 1) + timedelta(days=rng.randrange(3000))).strftime('%a %b %d 10:00:00 UTC %Y')]
               for c in ['Halcyon Freight', 'Lakemoor University', 'Kestrel Talent', 'Duskwood Robotics']]
    events = [[f'Lakemoor Data Meetup #{k + 1}', d.strftime('%b %d, %Y, 6:30 PM'), 'Attending', ''] for k, d in enumerate(MEETUPS)]
    events.append(['Fleet Electrification Summit', 'Mar 14, 2025, 9:00 AM', 'Attending', ''])
    follow_people = [[f'{rng.choice(FIRST)} {rng.choice(LAST)}', '2024-05-01', 'Active'] for _ in range(6)]
    follow_people += [[f'{r[0]} {r[1]}', '2023-02-01', 'Active'] for r in rng.sample(rows, 5)]
    return {
        'Skills.csv': (['Name'], [[s] for s in skills]),
        'Endorsement_Received_Info.csv': (['Endorsement Date', 'Skill Name', 'Endorser First Name', 'Endorser Last Name', 'Endorser Public Url', 'Endorsement Status'], rec),
        'Endorsement_Given_Info.csv': (['Endorsement Date', 'Skill Name', 'Endorsee First Name', 'Endorsee Last Name', 'Endorsee Public Url', 'Endorsement Status'], given),
        'Education.csv': (['School Name', 'Start Date', 'End Date', 'Notes', 'Degree Name', 'Activities'], [['Lakemoor University', '2011', '2014', '', 'BSc Economics', '']]),
        'Company Follows.csv': (['Organization', 'Followed On'], follows),
        'Member_Follows.csv': (['Date', 'FullName', 'Status'], [[d, n, s] for n, d, s in follow_people]),
        'Groups.csv': (['Title', 'Description', 'Website'], [[g, '', ''] for g in GROUPS]),
        'Events.csv': (['Event Name', 'Event Time', 'Status', 'External Url'], events),
        'Shares.csv': (['Date', 'ShareLink', 'ShareCommentary', 'SharedUrl', 'MediaUrl', 'Visibility'], shares),
        'Comments.csv': (['Date', 'Link', 'Message'], comments),
        'Reactions.csv': (['Date', 'Type', 'Link'], reacts),
    }


def _table(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))
    i = next(i for i, r in enumerate(rows) if len(r) > 2)
    return [dict(zip(rows[i], r)) for r in rows[i + 1:] if len(r) > 2]


def _overlap(real_dir, demo_dir):
    """Colliding values (internal only; never print them)."""
    real = _table(os.path.join(real_dir, 'Connections.csv'))
    lasts = {r.get('Last Name', '').strip().lower() for r in real} - {''}
    cos = {r.get('Company', '').strip().lower() for r in real} - {''}
    demo = _table(os.path.join(demo_dir, 'data', 'Connections.csv'))
    hits = [r['Company'].strip().lower() for r in demo if r['Company'].strip().lower() in cos]
    hits += [r['Last Name'].strip().lower() for r in demo
             if len(r['Last Name'].strip()) >= 5 and r['Last Name'].strip().lower() in lasts]
    pos = _table(os.path.join(demo_dir, 'data', 'Positions.csv'))
    hits += [r['Company Name'].strip().lower() for r in pos if r['Company Name'].strip().lower() in cos]
    return hits


def check_no_overlap(real_dir, demo_dir=os.path.join(ROOT, 'demo')):
    n = len(_overlap(real_dir, demo_dir))
    print(f'privacy overlap count: {n}')
    return n


def main(argv):
    real = argv[argv.index('--check') + 1] if '--check' in argv else None
    bad = set()
    for _ in range(20):
        write(*gen(42, frozenset(bad)))
        if not real:
            break
        hits = set(_overlap(real, os.path.join(ROOT, 'demo')))
        if not hits:
            break
        bad |= hits  # substitute: block colliding values and regenerate
    if real and check_no_overlap(real) > 0:
        sys.exit('synth: privacy overlap could not be removed')
    print('wrote demo/data/*.csv (connections, positions, layer files) and demo/truth.csv')


if __name__ == '__main__':
    main(sys.argv[1:])
