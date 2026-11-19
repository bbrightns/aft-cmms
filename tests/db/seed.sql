-- Data the checks in run.sh expect (run after both migration files)
INSERT INTO app_roles (email, role, updated_by) VALUES ('admin@gmail.com', 'admin', 'test'), ('staff@gmail.com', 'staff', 'test');
INSERT INTO approval_roles (role, email) VALUES ('approver', 'appr@gmail.com');
UPDATE auth.users SET raw_user_meta_data = '{"display_name":"Golf"}' WHERE email = 'staff@gmail.com';
INSERT INTO inventory (id, "Part ID", "Actual", "Location") VALUES ('i1', 'SPFL-C-0001', '5', 'A');
INSERT INTO logs (type, msg) VALUES ('seed', 'seed');
INSERT INTO pr_records (id, "PR No.") VALUES ('p1', 'PR1');
