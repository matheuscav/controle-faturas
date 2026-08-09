require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serve os arquivos da pasta public (o HTML)

// ---- Conexão com o banco ----
// Em produção (nuvem), essas variáveis vêm do painel da plataforma de hospedagem.
// Localmente, elas vêm do arquivo .env (que não é enviado ao GitHub).
const db = mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'controle_faturas'
});

db.connect((err) => {
    if (err) {
        console.error('Erro ao conectar no banco:', err);
        return;
    }
    console.log('Conectado ao MySQL com sucesso!');
});

// ---- ROTA: cadastrar empresa ----
app.post('/api/empresas', (req, res) => {
    const { nome_empresa, cnpj } = req.body;

    const cnpjLimpo = (cnpj || '').replace(/\D/g, ''); // remove tudo que não é número

    if (!nome_empresa || cnpjLimpo.length !== 14) {
        return res.status(400).json({ erro: 'Nome da empresa ou CNPJ inválido (CNPJ precisa ter 14 dígitos).' });
    }

    const sql = 'INSERT INTO empresas (nome_empresa, cnpj) VALUES (?, ?)';
    db.query(sql, [nome_empresa, cnpjLimpo], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ erro: 'Já existe uma empresa cadastrada com esse CNPJ.' });
            }
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao cadastrar empresa.' });
        }
        res.status(201).json({ mensagem: 'Empresa cadastrada com sucesso!', id: result.insertId });
    });
});

// ---- ROTA: listar empresas (para o dropdown) ----
app.get('/api/empresas', (req, res) => {
    db.query('SELECT id_empresa, nome_empresa, cnpj FROM empresas ORDER BY nome_empresa', (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao buscar empresas.' });
        }
        res.json(rows);
    });
});

// ---- ROTA: cadastrar fatura ----
app.post('/api/faturas', (req, res) => {
    const { nome_fatura, numero_fatura, id_empresa, data_vencimento, valor } = req.body;

    if (!nome_fatura || !id_empresa || !data_vencimento) {
        return res.status(400).json({ erro: 'Preencha nome da fatura, empresa e data de vencimento.' });
    }

    const sql = `INSERT INTO faturas (nome_fatura, numero_fatura, id_empresa, data_vencimento, valor)
                 VALUES (?, ?, ?, ?, ?)`;
    db.query(sql, [nome_fatura, numero_fatura || null, id_empresa, data_vencimento, valor || null], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao cadastrar fatura.' });
        }
        res.status(201).json({ mensagem: 'Fatura cadastrada com sucesso!', id: result.insertId });
    });
});

// ---- ROTA: listar faturas (para conferência) ----
app.get('/api/faturas', (req, res) => {
    const sql = `
        SELECT f.id_fatura, f.nome_fatura, f.numero_fatura, e.nome_empresa, e.cnpj, f.data_vencimento, f.valor, f.status_pagamento
        FROM faturas f
        JOIN empresas e ON f.id_empresa = e.id_empresa
        ORDER BY f.data_vencimento ASC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao buscar faturas.' });
        }
        res.json(rows);
    });
});

// ---- ROTA: apagar fatura ----
app.delete('/api/faturas/:id', (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM faturas WHERE id_fatura = ?', [id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao apagar fatura.' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ erro: 'Fatura não encontrada.' });
        }
        res.json({ mensagem: 'Fatura apagada com sucesso!' });
    });
});

// ---- ROTA: marcar fatura como paga ----
app.patch('/api/faturas/:id/pagar', (req, res) => {
    const { id } = req.params;
    db.query("UPDATE faturas SET status_pagamento = 'pago' WHERE id_fatura = ?", [id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao atualizar fatura.' });
        }
        res.json({ mensagem: 'Fatura marcada como paga!' });
    });
});

// ---- ROTA: consultar faturas com filtros ----
app.get('/api/faturas/consulta', (req, res) => {
    const { id_empresa, status, data_inicio, data_fim, numero_fatura } = req.query;

    let sql = `
        SELECT f.id_fatura, f.nome_fatura, f.numero_fatura, e.nome_empresa, e.cnpj, f.data_vencimento, f.valor, f.status_pagamento
        FROM faturas f
        JOIN empresas e ON f.id_empresa = e.id_empresa
        WHERE 1=1
    `;
    const params = [];

    if (id_empresa) {
        sql += ' AND f.id_empresa = ?';
        params.push(id_empresa);
    }
    if (status) {
        sql += ' AND f.status_pagamento = ?';
        params.push(status);
    }
    if (data_inicio) {
        sql += ' AND f.data_vencimento >= ?';
        params.push(data_inicio);
    }
    if (data_fim) {
        sql += ' AND f.data_vencimento <= ?';
        params.push(data_fim);
    }
    if (numero_fatura) {
        sql += ' AND f.numero_fatura LIKE ?';
        params.push(`%${numero_fatura}%`);
    }

    sql += ' ORDER BY f.data_vencimento ASC';

    db.query(sql, params, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao consultar faturas.' });
        }
        res.json(rows);
    });
});

// ---- ROTA: resumo do dashboard (cards) ----
app.get('/api/dashboard/resumo', (req, res) => {
    const sql = `
        SELECT
            COALESCE(SUM(CASE WHEN MONTH(data_vencimento) = MONTH(CURDATE())
                               AND YEAR(data_vencimento) = YEAR(CURDATE())
                          THEN valor ELSE 0 END), 0) AS total_mes,
            COALESCE(SUM(CASE WHEN data_vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                               AND status_pagamento != 'pago'
                          THEN 1 ELSE 0 END), 0) AS vencendo_7_dias,
            COALESCE(SUM(CASE WHEN data_vencimento < CURDATE() AND status_pagamento != 'pago'
                          THEN 1 ELSE 0 END), 0) AS atrasadas,
            COUNT(*) AS total_faturas
        FROM faturas
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao buscar resumo.' });
        }
        res.json(rows[0]);
    });
});

// ---- ROTA: gastos por empresa (gráfico) ----
app.get('/api/dashboard/por-empresa', (req, res) => {
    const sql = `
        SELECT e.nome_empresa, COALESCE(SUM(f.valor), 0) AS total
        FROM faturas f
        JOIN empresas e ON f.id_empresa = e.id_empresa
        GROUP BY e.nome_empresa
        ORDER BY total DESC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao buscar gastos por empresa.' });
        }
        res.json(rows);
    });
});

// ---- ROTA: faturas vencendo em breve ou atrasadas (lista do dashboard) ----
app.get('/api/dashboard/alertas', (req, res) => {
    const sql = `
        SELECT f.nome_fatura, e.nome_empresa, f.data_vencimento, f.valor,
               CASE WHEN f.data_vencimento < CURDATE() THEN 'atrasada' ELSE 'proxima' END AS situacao
        FROM faturas f
        JOIN empresas e ON f.id_empresa = e.id_empresa
        WHERE f.status_pagamento != 'pago'
          AND f.data_vencimento <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        ORDER BY f.data_vencimento ASC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ erro: 'Erro ao buscar alertas.' });
        }
        res.json(rows);
    });
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`Servidor rodando em http://localhost:${PORTA}`);
});
