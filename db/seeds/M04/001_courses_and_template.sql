-- QY-MYSQL-1.0.0 / V001. Only seven M04-owned tables may be written here.
-- Run in an initialized, empty local M04 development DB. No users, health data,
-- points, completed workouts or real reminder configurations are seeded.
SET time_zone = '+00:00';
START TRANSACTION;
INSERT INTO training_courses (id,title,category,level,description,estimated_duration_seconds,estimated_calories_kcal,status)
SELECT 'c0000000-0000-4000-8000-000000000001','全身轻柔舒展','stretch','beginner','先做缓慢呼吸，再舒展肩颈、背部及下肢。动作保持舒适幅度，疼痛时停止。',600,60.0,'published'
WHERE NOT EXISTS (SELECT 1 FROM training_courses WHERE id='c0000000-0000-4000-8000-000000000001');
INSERT INTO training_plan_templates (id,title,description,status)
SELECT 'c0000000-0000-4000-8000-000000000002','轻松开启 · 七日计划','四次全身舒展与三天恢复，建立自己的运动节奏。','published'
WHERE NOT EXISTS (SELECT 1 FROM training_plan_templates WHERE id='c0000000-0000-4000-8000-000000000002');
INSERT INTO training_template_items (id,template_id,day_offset,course_id,rest_day,sort_order)
SELECT 'c0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-000000000002',0,'c0000000-0000-4000-8000-000000000001',0,0
WHERE NOT EXISTS (SELECT 1 FROM training_template_items WHERE template_id='c0000000-0000-4000-8000-000000000002' AND day_offset=0 AND sort_order=0);
INSERT INTO training_template_items (id,template_id,day_offset,course_id,rest_day,sort_order)
SELECT 'c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000002',1,NULL,1,0
WHERE NOT EXISTS (SELECT 1 FROM training_template_items WHERE template_id='c0000000-0000-4000-8000-000000000002' AND day_offset=1 AND sort_order=0);
INSERT INTO training_template_items (id,template_id,day_offset,course_id,rest_day,sort_order)
SELECT 'c0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000002',2,'c0000000-0000-4000-8000-000000000001',0,0
WHERE NOT EXISTS (SELECT 1 FROM training_template_items WHERE template_id='c0000000-0000-4000-8000-000000000002' AND day_offset=2 AND sort_order=0);
INSERT INTO training_template_items (id,template_id,day_offset,course_id,rest_day,sort_order)
SELECT 'c0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000002',3,NULL,1,0
WHERE NOT EXISTS (SELECT 1 FROM training_template_items WHERE template_id='c0000000-0000-4000-8000-000000000002' AND day_offset=3 AND sort_order=0);
INSERT INTO training_template_items (id,template_id,day_offset,course_id,rest_day,sort_order)
SELECT 'c0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000002',4,'c0000000-0000-4000-8000-000000000001',0,0
WHERE NOT EXISTS (SELECT 1 FROM training_template_items WHERE template_id='c0000000-0000-4000-8000-000000000002' AND day_offset=4 AND sort_order=0);
INSERT INTO training_template_items (id,template_id,day_offset,course_id,rest_day,sort_order)
SELECT 'c0000000-0000-4000-8000-000000000015','c0000000-0000-4000-8000-000000000002',5,NULL,1,0
WHERE NOT EXISTS (SELECT 1 FROM training_template_items WHERE template_id='c0000000-0000-4000-8000-000000000002' AND day_offset=5 AND sort_order=0);
INSERT INTO training_template_items (id,template_id,day_offset,course_id,rest_day,sort_order)
SELECT 'c0000000-0000-4000-8000-000000000016','c0000000-0000-4000-8000-000000000002',6,'c0000000-0000-4000-8000-000000000001',0,0
WHERE NOT EXISTS (SELECT 1 FROM training_template_items WHERE template_id='c0000000-0000-4000-8000-000000000002' AND day_offset=6 AND sort_order=0);
COMMIT;
